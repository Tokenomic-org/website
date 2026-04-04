var fs = require('fs');
var path = require('path');

var articles = JSON.parse(fs.readFileSync('scripts/articles-data.json', 'utf-8'));
var learnIndex = fs.readFileSync('_site/learn/index.html', 'utf-8');

var headerEnd = learnIndex.indexOf('<section class="learn-hero">');
if (headerEnd === -1) headerEnd = learnIndex.indexOf('<!-- Banner Section -->');
if (headerEnd === -1) headerEnd = learnIndex.indexOf('<section class="page-banner">');
if (headerEnd === -1) headerEnd = learnIndex.indexOf('<section class="learn-page">');

var headerHtml = learnIndex.substring(0, headerEnd);

var learnStyleStart = headerHtml.indexOf('<style>');
var learnStyleEnd = -1;
if (learnStyleStart !== -1) {
  var tempIdx = learnStyleStart;
  while (true) {
    var nextEnd = headerHtml.indexOf('</style>', tempIdx);
    if (nextEnd === -1) break;
    learnStyleEnd = nextEnd + 8;
    tempIdx = nextEnd + 1;
  }
}
if (learnStyleStart !== -1 && learnStyleEnd !== -1) {
  var lastStyleStart = headerHtml.lastIndexOf('<style>');
  if (lastStyleStart > 0) {
    var lastStyleEnd = headerHtml.indexOf('</style>', lastStyleStart);
    if (lastStyleEnd !== -1 && headerHtml.substring(lastStyleStart, lastStyleEnd).indexOf('.learn-hero') !== -1) {
      headerHtml = headerHtml.substring(0, lastStyleStart) + headerHtml.substring(lastStyleEnd + 8);
    }
  }
}

var footerStart = learnIndex.indexOf('<footer class="main-footer');
var footerHtml = learnIndex.substring(footerStart);

var IMAGE_MAP = {
  'iron-condor-butterfly-spread': 'Butterfly.png',
  'advanced-strategies-in-defi': 'defi.png',
  'arbitrage-a-practical-guide': 'arbitrage.png',
  'case-studies-successful-arbitrage': 'case-studies-arbitrage.png',
  'smart-contract-security-best-practices': 'cyber_security_crypto.png',
  'role-of-smart-contracts': 'smart-contracts.png',
  'fundamentals-building-blockchain': 'fundamentals-building-blockchain.png',
  'zero-knowledge-proofs': 'zero-knowledge-proofs.png',
  'decentralized-data-storage': 'decentralized-data-storage.png',
  'the-basics-of-defi': 'defi-basics.png',
  'analysis-defi-impact-traditional-financial-markets': 'Analysis-of-DeFi.png',
  'gas-optimization-solidity': 'cyber_security_crypto.png',
  'upgradeable-proxy-contracts': 'smart-contracts.png',
  'nestor-the-biz-star': 'Butterfly.png'
};

var AUTHOR_MAP = {
  'iron-condor-butterfly-spread': 'Guillaume Lauzier',
  'advanced-strategies-in-defi': 'Guillaume Lauzier',
  'arbitrage-a-practical-guide': 'Guillaume Lauzier',
  'case-studies-successful-arbitrage': 'Guillaume Lauzier',
  'smart-contract-security-best-practices': 'Guillaume Lauzier',
  'role-of-smart-contracts': 'Guillaume Lauzier',
  'fundamentals-building-blockchain': 'Guillaume Lauzier',
  'zero-knowledge-proofs': 'Guillaume Lauzier',
  'decentralized-data-storage': 'Guillaume Lauzier',
  'the-basics-of-defi': 'Guillaume Lauzier',
  'analysis-defi-impact-traditional-financial-markets': 'Guillaume Lauzier',
  'gas-optimization-solidity': 'Guillaume Lauzier',
  'upgradeable-proxy-contracts': 'Guillaume Lauzier',
  'nestor-the-biz-star': 'Guillaume Lauzier'
};

var AUTHOR_PROFILES = {
  'Dr. Sarah Chen': {
    specialty: 'Tokenomics & Economic Design',
    bio: 'PhD in Economics from MIT. Advised 20+ DeFi protocols on tokenomics design and mechanism engineering.',
    avatar: '/assets/images/learn/100.jpg',
    wallet: '0x742d...bD1e'
  },
  'Guillaume Lauzier': {
    specialty: 'Technical Implementation & Institutional Strategy',
    bio: 'Founder & Institutional Educator at Tokenomic. A visionary specializing in technical implementation, financial analysis, and digital asset strategy. Former crypto mining facility operator who bridges infrastructure and institutional finance. Expert in DeFi and generative techniques, dedicated to advancing the digital economy through innovative technology and rigorous education.',
    avatar: '/assets/images/learn/100.jpg',
    wallet: '0x1234...abcd'
  },
  'Marcus Webb': {
    specialty: 'Smart Contract Security',
    bio: 'Former Trail of Bits auditor. 8+ years in blockchain security and smart contract analysis.',
    avatar: '/assets/images/learn/100.jpg',
    wallet: '0x8Ba1...BA72'
  },
  'Aisha Patel': {
    specialty: 'DeFi Protocol Strategy',
    bio: 'Ex-Aave contributor. Liquidity optimization and governance framework expert.',
    avatar: '/assets/images/learn/100.jpg',
    wallet: '0x2546...c30'
  }
};

function formatDate(dateStr) {
  var d = new Date(dateStr);
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function estimateReadingTime(html) {
  var text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  var words = text.split(' ').length;
  return Math.max(1, Math.ceil(words / 200));
}

function getArticleStyle() {
  return '\n<style>\n' +
    '.article-detail { padding: 60px 0 80px; background: #fff; }\n' +
    '.article-detail .back-link { display: inline-flex; align-items: center; gap: 8px; color: #5a8299; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 30px; transition: color 0.2s; }\n' +
    '.article-detail .back-link:hover { color: #001f29; }\n' +
    '.article-detail .article-header { margin-bottom: 40px; }\n' +
    '.article-detail .article-meta { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; font-size: 13px; color: #5a8299; text-transform: uppercase; letter-spacing: 0.5px; flex-wrap: wrap; }\n' +
    '.article-detail .article-meta .cat-tag { display: inline-block; padding: 4px 14px; background: #f5f5f5; border-radius: 20px; font-weight: 600; color: #001f29; font-size: 12px; }\n' +
    '.article-detail .article-meta .reading-time { display: inline-flex; align-items: center; gap: 4px; }\n' +
    '.article-detail .article-title { font-size: 36px; font-weight: 700; color: #001f29; line-height: 1.3; margin-bottom: 16px; }\n' +
    '.article-detail .article-author-line { font-size: 15px; color: #5a8299; margin-bottom: 30px; }\n' +
    '.article-detail .article-author-line strong { color: #001f29; }\n' +
    '.article-detail .featured-image { width: 100%; max-height: 500px; object-fit: cover; border-radius: 12px; margin-bottom: 40px; }\n' +
    '.article-detail .article-body { font-size: 17px; line-height: 1.8; color: #2D3748; max-width: 800px; }\n' +
    '.article-detail .article-body h1 { font-size: 32px; font-weight: 700; color: #001f29; margin: 40px 0 20px; line-height: 1.3; }\n' +
    '.article-detail .article-body h2 { font-size: 26px; font-weight: 700; color: #001f29; margin: 36px 0 16px; line-height: 1.3; }\n' +
    '.article-detail .article-body h3 { font-size: 22px; font-weight: 600; color: #001f29; margin: 30px 0 14px; }\n' +
    '.article-detail .article-body h4 { font-size: 19px; font-weight: 600; color: #001f29; margin: 24px 0 12px; }\n' +
    '.article-detail .article-body p { margin-bottom: 20px; }\n' +
    '.article-detail .article-body ul, .article-detail .article-body ol { margin-bottom: 20px; padding-left: 24px; }\n' +
    '.article-detail .article-body li { margin-bottom: 8px; }\n' +
    '.article-detail .article-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 20px 0; }\n' +
    '.article-detail .article-body blockquote { border-left: 4px solid #ff6000; padding: 16px 24px; margin: 24px 0; background: #fff8f0; border-radius: 0 8px 8px 0; font-style: italic; color: #5a6c7d; }\n' +
    '.article-detail .article-body pre, .article-detail .article-body code { background: #f4f6f8; border-radius: 6px; font-family: "Fira Code", monospace; font-size: 14px; }\n' +
    '.article-detail .article-body pre { padding: 20px; overflow-x: auto; margin: 20px 0; }\n' +
    '.article-detail .article-body code { padding: 2px 6px; }\n' +
    '.article-detail .article-body pre code { padding: 0; background: none; }\n' +
    '.article-detail .article-body table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px; }\n' +
    '.article-detail .article-body th, .article-detail .article-body td { padding: 12px 16px; border: 1px solid #e8eef2; text-align: left; }\n' +
    '.article-detail .article-body th { background: #f4f6f8; font-weight: 600; color: #001f29; }\n' +
    '.article-detail .article-body a { color: #667eea; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }\n' +
    '.article-detail .article-body a:hover { border-bottom-color: #667eea; }\n' +

    '.share-section { margin-top: 50px; padding: 30px 0; border-top: 2px solid #f0f0f0; border-bottom: 2px solid #f0f0f0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }\n' +
    '.share-section span.share-label { font-weight: 600; color: #001f29; font-size: 15px; }\n' +
    '.share-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #f0f2f5; color: #5a8299; text-decoration: none; transition: all 0.2s; font-size: 16px; border: none; cursor: pointer; }\n' +
    '.share-btn:hover { background: #001f29; color: #fff; }\n' +
    '.share-btn.twitter:hover { background: #1DA1F2; }\n' +
    '.share-btn.facebook:hover { background: #4267B2; }\n' +
    '.share-btn.linkedin:hover { background: #0077B5; }\n' +
    '.share-btn.reddit:hover { background: #FF4500; }\n' +
    '.share-btn.copy-link:hover { background: #ff6000; }\n' +
    '.share-btn .copy-tooltip { display: none; position: absolute; top: -32px; left: 50%; transform: translateX(-50%); background: #001f29; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 11px; white-space: nowrap; }\n' +
    '.share-btn.copied .copy-tooltip { display: block; }\n' +

    '.expert-profile-card { margin-top: 50px; padding: 32px; background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%); border-radius: 16px; border: 1px solid #e8eef5; }\n' +
    '.expert-profile-card .profile-header { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; }\n' +
    '.expert-profile-card .profile-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 3px solid #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }\n' +
    '.expert-profile-card .profile-avatar-placeholder { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 28px; font-weight: 700; flex-shrink: 0; }\n' +
    '.expert-profile-card .profile-info h3 { font-size: 20px; font-weight: 700; color: #001f29; margin: 0 0 4px; }\n' +
    '.expert-profile-card .profile-info .profile-specialty { font-size: 14px; color: #667eea; font-weight: 600; margin: 0 0 2px; }\n' +
    '.expert-profile-card .profile-info .profile-wallet { font-size: 12px; color: #9ca3af; font-family: monospace; }\n' +
    '.expert-profile-card .profile-bio { font-size: 15px; line-height: 1.7; color: #4a5568; margin: 0; }\n' +
    '.expert-profile-card .profile-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 8px 20px; background: #001f29; color: #fff; border-radius: 30px; text-decoration: none; font-size: 13px; font-weight: 600; transition: background 0.2s; }\n' +
    '.expert-profile-card .profile-link:hover { background: #667eea; }\n' +

    '.comments-section { margin-top: 50px; }\n' +
    '.comments-section h3 { font-size: 22px; font-weight: 700; color: #001f29; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }\n' +
    '.comments-section .comment-count { display: inline-flex; align-items: center; justify-content: center; background: #f0f2f5; color: #5a8299; font-size: 13px; font-weight: 600; padding: 2px 10px; border-radius: 12px; }\n' +
    '.comment-form { background: #f8f9fb; border-radius: 12px; padding: 24px; margin-bottom: 32px; border: 1px solid #e8eef2; }\n' +
    '.comment-form .form-row { display: flex; gap: 12px; margin-bottom: 12px; }\n' +
    '.comment-form .form-row input { flex: 1; padding: 10px 16px; border: 1px solid #e0e4e8; border-radius: 8px; font-size: 14px; background: #fff; transition: border-color 0.2s; }\n' +
    '.comment-form .form-row input:focus { outline: none; border-color: #667eea; }\n' +
    '.comment-form textarea { width: 100%; padding: 12px 16px; border: 1px solid #e0e4e8; border-radius: 8px; font-size: 14px; min-height: 100px; resize: vertical; background: #fff; font-family: inherit; transition: border-color 0.2s; box-sizing: border-box; }\n' +
    '.comment-form textarea:focus { outline: none; border-color: #667eea; }\n' +
    '.comment-form .submit-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 24px; background: #ff6000; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-top: 12px; }\n' +
    '.comment-form .submit-btn:hover { background: #e55500; }\n' +
    '.comment-form .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }\n' +
    '.comment-form .form-msg { font-size: 13px; margin-top: 8px; }\n' +
    '.comment-form .form-msg.success { color: #22c55e; }\n' +
    '.comment-form .form-msg.error { color: #ef4444; }\n' +
    '.comments-list { list-style: none; padding: 0; margin: 0; }\n' +
    '.comments-list .comment-item { padding: 20px 0; border-bottom: 1px solid #f0f0f0; }\n' +
    '.comments-list .comment-item:last-child { border-bottom: none; }\n' +
    '.comments-list .comment-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }\n' +
    '.comments-list .comment-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; font-weight: 700; flex-shrink: 0; }\n' +
    '.comments-list .comment-author { font-weight: 600; color: #001f29; font-size: 14px; }\n' +
    '.comments-list .comment-date { font-size: 12px; color: #9ca3af; }\n' +
    '.comments-list .comment-text { font-size: 15px; line-height: 1.7; color: #4a5568; margin: 0; padding-left: 48px; }\n' +
    '.comments-list .no-comments { text-align: center; padding: 40px 20px; color: #9ca3af; font-size: 15px; }\n' +

    '@media (max-width: 767px) {\n' +
    '  .article-detail .article-title { font-size: 26px; }\n' +
    '  .article-detail .article-body { font-size: 16px; }\n' +
    '  .expert-profile-card .profile-header { flex-direction: column; text-align: center; }\n' +
    '  .expert-profile-card { padding: 24px 16px; }\n' +
    '  .comment-form .form-row { flex-direction: column; }\n' +
    '  .comments-list .comment-text { padding-left: 0; margin-top: 8px; }\n' +
    '}\n' +
    '</style>\n';
}

function getShareSection(article) {
  var url = 'https://tokenomic.org/learn/' + article.slug;
  var title = encodeURIComponent(article.title);
  var encodedUrl = encodeURIComponent(url);

  return '        <div class="share-section">\n' +
    '            <span class="share-label">Share this article:</span>\n' +
    '            <a href="https://twitter.com/intent/tweet?text=' + title + '&url=' + encodedUrl + '" target="_blank" rel="noopener" class="share-btn twitter" title="Share on X (Twitter)"><i class="fab fa-twitter"></i></a>\n' +
    '            <a href="https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl + '" target="_blank" rel="noopener" class="share-btn facebook" title="Share on Facebook"><i class="fab fa-facebook-f"></i></a>\n' +
    '            <a href="https://www.linkedin.com/shareArticle?mini=true&url=' + encodedUrl + '&title=' + title + '" target="_blank" rel="noopener" class="share-btn linkedin" title="Share on LinkedIn"><i class="fab fa-linkedin-in"></i></a>\n' +
    '            <a href="https://www.reddit.com/submit?url=' + encodedUrl + '&title=' + title + '" target="_blank" rel="noopener" class="share-btn reddit" title="Share on Reddit"><i class="fab fa-reddit-alien"></i></a>\n' +
    '            <button class="share-btn copy-link" title="Copy link" onclick="copyArticleLink(this)" style="position:relative;"><i class="fas fa-link"></i><span class="copy-tooltip">Copied!</span></button>\n' +
    '        </div>\n';
}

function getExpertProfileCard(authorName) {
  var profile = AUTHOR_PROFILES[authorName];
  if (!profile) return '';

  var initials = authorName.split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2);

  var avatarHtml = profile.avatar
    ? '<img class="profile-avatar" src="' + profile.avatar + '" alt="' + escapeHtml(authorName) + '">'
    : '<div class="profile-avatar-placeholder">' + initials + '</div>';

  var profileSlug = authorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return '        <a href="/expert/' + profileSlug + '" class="expert-profile-card" style="text-decoration:none;color:inherit;display:block;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.boxShadow=\'0 4px 20px rgba(102,126,234,0.15)\';this.style.borderColor=\'#667eea\'" onmouseout="this.style.boxShadow=\'none\';this.style.borderColor=\'#e8eef5\'">\n' +
    '            <div class="profile-header">\n' +
    '                ' + avatarHtml + '\n' +
    '                <div class="profile-info">\n' +
    '                    <h3>' + escapeHtml(authorName) + '</h3>\n' +
    '                    <p class="profile-specialty">' + escapeHtml(profile.specialty) + '</p>\n' +
    '                    <p class="profile-wallet">' + escapeHtml(profile.wallet) + '</p>\n' +
    '                </div>\n' +
    '            </div>\n' +
    '            <p class="profile-bio">' + escapeHtml(profile.bio) + '</p>\n' +
    '            <span class="profile-link">View Full Profile <i class="fas fa-arrow-right"></i></span>\n' +
    '        </a>\n';
}

function getCommentsSection(slug) {
  return '        <div class="comments-section" id="comments">\n' +
    '            <h3><i class="far fa-comments" style="color:#667eea;"></i> Discussion <span class="comment-count" id="comment-count">0</span></h3>\n' +
    '            <div class="comment-form">\n' +
    '                <div class="form-row">\n' +
    '                    <input type="text" id="comment-author" placeholder="Your name" maxlength="50">\n' +
    '                </div>\n' +
    '                <textarea id="comment-text" placeholder="Share your thoughts on this article..." maxlength="2000"></textarea>\n' +
    '                <button class="submit-btn" id="submit-comment" onclick="submitArticleComment()">Post Comment</button>\n' +
    '                <div class="form-msg" id="comment-msg"></div>\n' +
    '            </div>\n' +
    '            <ul class="comments-list" id="comments-list">\n' +
    '                <li class="no-comments" id="no-comments-msg">Be the first to share your thoughts!</li>\n' +
    '            </ul>\n' +
    '        </div>\n';
}

function getCommentsScript(slug) {
  return '<script>\n' +
    'var articleSlug = "' + slug + '";\n' +
    '\n' +
    'function formatCommentDate(isoStr) {\n' +
    '  var d = new Date(isoStr);\n' +
    '  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];\n' +
    '  var now = new Date();\n' +
    '  var diff = Math.floor((now - d) / 1000);\n' +
    '  if (diff < 60) return "just now";\n' +
    '  if (diff < 3600) return Math.floor(diff / 60) + "m ago";\n' +
    '  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";\n' +
    '  if (diff < 604800) return Math.floor(diff / 86400) + "d ago";\n' +
    '  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();\n' +
    '}\n' +
    '\n' +
    'function renderComment(c) {\n' +
    '  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
    '  var safeAuthor = esc(c.author || "Anonymous");\n' +
    '  var safeText = esc(c.text);\n' +
    '  var initials = (c.author || "A").split(" ").map(function(w){return w[0];}).join("").substring(0,2).toUpperCase();\n' +
    '  return \'<li class="comment-item">\' +\n' +
    '    \'<div class="comment-header">\' +\n' +
    '    \'<div class="comment-avatar">\' + esc(initials) + \'</div>\' +\n' +
    '    \'<div><span class="comment-author">\' + safeAuthor + \'</span>\' +\n' +
    '    \'<div class="comment-date">\' + formatCommentDate(c.created_at) + \'</div></div>\' +\n' +
    '    \'</div>\' +\n' +
    '    \'<p class="comment-text">\' + safeText + \'</p>\' +\n' +
    '    \'</li>\';\n' +
    '}\n' +
    '\n' +
    'function loadArticleComments() {\n' +
    '  fetch("/api/articles/" + articleSlug + "/comments")\n' +
    '    .then(function(r) { return r.json(); })\n' +
    '    .then(function(data) {\n' +
    '      var list = document.getElementById("comments-list");\n' +
    '      var count = document.getElementById("comment-count");\n' +
    '      var noMsg = document.getElementById("no-comments-msg");\n' +
    '      if (data.comments && data.comments.length > 0) {\n' +
    '        if (noMsg) noMsg.style.display = "none";\n' +
    '        var html = "";\n' +
    '        data.comments.forEach(function(c) { html += renderComment(c); });\n' +
    '        list.innerHTML = html;\n' +
    '        count.textContent = data.comments.length;\n' +
    '      }\n' +
    '    })\n' +
    '    .catch(function() {});\n' +
    '}\n' +
    '\n' +
    'function submitArticleComment() {\n' +
    '  var btn = document.getElementById("submit-comment");\n' +
    '  var msg = document.getElementById("comment-msg");\n' +
    '  var author = document.getElementById("comment-author").value.trim();\n' +
    '  var text = document.getElementById("comment-text").value.trim();\n' +
    '\n' +
    '  if (!text) { msg.textContent = "Please enter a comment."; msg.className = "form-msg error"; return; }\n' +
    '\n' +
    '  btn.disabled = true;\n' +
    '  btn.textContent = "Posting...";\n' +
    '  msg.textContent = "";\n' +
    '\n' +
    '  var wallet = "";\n' +
    '  if (typeof TokenomicWallet !== "undefined" && TokenomicWallet.account) {\n' +
    '    wallet = TokenomicWallet.account;\n' +
    '  }\n' +
    '\n' +
    '  fetch("/api/articles/" + articleSlug + "/comments", {\n' +
    '    method: "POST",\n' +
    '    headers: { "Content-Type": "application/json" },\n' +
    '    body: JSON.stringify({ author: author || "Anonymous", text: text, wallet: wallet })\n' +
    '  })\n' +
    '  .then(function(r) { return r.json(); })\n' +
    '  .then(function(data) {\n' +
    '    if (data.success) {\n' +
    '      msg.textContent = "Comment posted!"; msg.className = "form-msg success";\n' +
    '      document.getElementById("comment-text").value = "";\n' +
    '      loadArticleComments();\n' +
    '    } else {\n' +
    '      msg.textContent = data.error || "Failed to post."; msg.className = "form-msg error";\n' +
    '    }\n' +
    '  })\n' +
    '  .catch(function() { msg.textContent = "Network error."; msg.className = "form-msg error"; })\n' +
    '  .finally(function() { btn.disabled = false; btn.textContent = "Post Comment"; });\n' +
    '}\n' +
    '\n' +
    'function copyArticleLink(btn) {\n' +
    '  var url = "https://tokenomic.org/learn/' + slug + '";\n' +
    '  if (navigator.clipboard) {\n' +
    '    navigator.clipboard.writeText(url).then(function() {\n' +
    '      btn.classList.add("copied");\n' +
    '      setTimeout(function() { btn.classList.remove("copied"); }, 2000);\n' +
    '    });\n' +
    '  } else {\n' +
    '    var input = document.createElement("input");\n' +
    '    input.value = url; document.body.appendChild(input);\n' +
    '    input.select(); document.execCommand("copy");\n' +
    '    document.body.removeChild(input);\n' +
    '    btn.classList.add("copied");\n' +
    '    setTimeout(function() { btn.classList.remove("copied"); }, 2000);\n' +
    '  }\n' +
    '}\n' +
    '\n' +
    'document.addEventListener("DOMContentLoaded", loadArticleComments);\n' +
    '</script>\n';
}

articles.forEach(function(article) {
  if (article.content.length < 50) {
    console.log('Skipping ' + article.slug + ' (no content)');
    return;
  }

  var featuredImg = IMAGE_MAP[article.slug] ? '/assets/images/learn/' + IMAGE_MAP[article.slug] : article.featured_image;
  var authorName = AUTHOR_MAP[article.slug] || article.author;
  var readingTime = estimateReadingTime(article.content);

  var updatedHeader = headerHtml.replace(
    /<title>[^<]+<\/title>/,
    '<title>' + escapeHtml(article.title) + ' - Tokenomic</title>'
  );

  updatedHeader = updatedHeader.replace(
    '</head>',
    '<meta property="og:title" content="' + escapeHtml(article.title) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:url" content="https://tokenomic.org/learn/' + article.slug + '">\n' +
    (featuredImg ? '<meta property="og:image" content="https://tokenomic.org' + featuredImg + '">\n' : '') +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + escapeHtml(article.title) + '">\n' +
    '</head>'
  );

  var articleStyle = getArticleStyle();

  var pageHtml = updatedHeader + articleStyle +
    '<!-- Banner Section -->\n' +
    '<section class="page-banner">\n' +
    '    <div class="image-layer" style="background-image:url(/assets/images/background/banner-image-1.jpg);"></div>\n' +
    '    <div class="banner-inner">\n' +
    '        <div class="auto-container">\n' +
    '            <div class="inner-container clearfix">\n' +
    '                <h1>' + escapeHtml(article.title) + '</h1>\n' +
    '                <div class="page-nav">\n' +
    '                    <ul class="bread-crumb clearfix">\n' +
    '                        <li><a href="/">Home</a></li>\n' +
    '                        <li><a href="/learn/">Learn</a></li>\n' +
    '                        <li class="active">' + escapeHtml(article.category) + '</li>\n' +
    '                    </ul>\n' +
    '                </div>\n' +
    '            </div>\n' +
    '        </div>\n' +
    '    </div>\n' +
    '</section>\n\n' +
    '<section class="article-detail">\n' +
    '    <div class="auto-container">\n' +
    '        <a href="/learn/" class="back-link"><i class="fas fa-arrow-left"></i> Back to Learn</a>\n' +
    '        <div class="article-header">\n' +
    '            <div class="article-meta">\n' +
    '                <span class="cat-tag">' + escapeHtml(article.category) + '</span>\n' +
    '                <span>' + formatDate(article.date) + '</span>\n' +
    '                <span class="reading-time"><i class="far fa-clock"></i> ' + readingTime + ' min read</span>\n' +
    '            </div>\n' +
    '            <h1 class="article-title">' + escapeHtml(article.title) + '</h1>\n' +
    '            <div class="article-author-line">By <strong>' + escapeHtml(authorName) + '</strong></div>\n' +
    '        </div>\n' +
    (featuredImg ? '        <img class="featured-image" src="' + featuredImg + '" alt="' + escapeHtml(article.title) + '">\n' : '') +
    '        <div class="article-body">\n' +
    '            ' + article.content + '\n' +
    '        </div>\n' +
    getShareSection(article) +
    getExpertProfileCard(authorName) +
    getCommentsSection(article.slug) +
    '    </div>\n' +
    '</section>\n\n' +
    getCommentsScript(article.slug) +
    footerHtml;

  var dir = '_site/learn/' + article.slug;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/index.html', pageHtml);
  console.log('Generated: /learn/' + article.slug + '/');
});

console.log('\nDone! Generated ' + articles.filter(function(a) { return a.content.length >= 50; }).length + ' article pages.');
