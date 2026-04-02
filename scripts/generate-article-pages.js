var fs = require('fs');
var path = require('path');

var articles = JSON.parse(fs.readFileSync('scripts/articles-data.json', 'utf-8'));
var learnIndex = fs.readFileSync('_site/learn/index.html', 'utf-8');

var headerEnd = learnIndex.indexOf('<!-- Banner Section -->');
if (headerEnd === -1) headerEnd = learnIndex.indexOf('<section class="page-banner">');
if (headerEnd === -1) headerEnd = learnIndex.indexOf('<section class="learn-page">');

var headerHtml = learnIndex.substring(0, headerEnd);

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
  'iron-condor-butterfly-spread': 'Dr. Sarah Chen',
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

function formatDate(dateStr) {
  var d = new Date(dateStr);
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

articles.forEach(function(article) {
  if (article.content.length < 50) {
    console.log('Skipping ' + article.slug + ' (no content)');
    return;
  }

  var featuredImg = IMAGE_MAP[article.slug] ? '/assets/images/learn/' + IMAGE_MAP[article.slug] : article.featured_image;
  var authorName = AUTHOR_MAP[article.slug] || article.author;

  var updatedHeader = headerHtml.replace(
    /<title>[^<]+<\/title>/,
    '<title>' + escapeHtml(article.title) + ' - Tokenomic</title>'
  );

  var articleStyle = '\n<style>\n' +
    '.article-detail { padding: 60px 0 80px; background: #fff; }\n' +
    '.article-detail .back-link { display: inline-flex; align-items: center; gap: 8px; color: #5a8299; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 30px; transition: color 0.2s; }\n' +
    '.article-detail .back-link:hover { color: #001f29; }\n' +
    '.article-detail .article-header { margin-bottom: 40px; }\n' +
    '.article-detail .article-meta { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; font-size: 13px; color: #5a8299; text-transform: uppercase; letter-spacing: 0.5px; }\n' +
    '.article-detail .article-meta .cat-tag { display: inline-block; padding: 4px 14px; background: #f5f5f5; border-radius: 20px; font-weight: 600; color: #001f29; font-size: 12px; }\n' +
    '.article-detail .article-title { font-size: 36px; font-weight: 700; color: #001f29; line-height: 1.3; margin-bottom: 16px; }\n' +
    '.article-detail .article-author { font-size: 15px; color: #5a8299; margin-bottom: 30px; }\n' +
    '.article-detail .article-author strong { color: #001f29; }\n' +
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
    '.article-detail .share-section { margin-top: 50px; padding-top: 30px; border-top: 2px solid #f0f0f0; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }\n' +
    '.article-detail .share-section span { font-weight: 600; color: #001f29; font-size: 15px; }\n' +
    '.article-detail .share-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #f0f2f5; color: #5a8299; text-decoration: none; transition: all 0.2s; font-size: 16px; }\n' +
    '.article-detail .share-btn:hover { background: #001f29; color: #fff; }\n' +
    '@media (max-width: 767px) {\n' +
    '  .article-detail .article-title { font-size: 26px; }\n' +
    '  .article-detail .article-body { font-size: 16px; }\n' +
    '}\n' +
    '</style>\n';

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
    '        <a href="/learn/" class="back-link">&larr; Back to Learn</a>\n' +
    '        <div class="article-header">\n' +
    '            <div class="article-meta">\n' +
    '                <span class="cat-tag">' + escapeHtml(article.category) + '</span>\n' +
    '                <span>' + formatDate(article.date) + '</span>\n' +
    '            </div>\n' +
    '            <h1 class="article-title">' + escapeHtml(article.title) + '</h1>\n' +
    '            <div class="article-author">By <strong>' + escapeHtml(authorName) + '</strong></div>\n' +
    '        </div>\n' +
    (featuredImg ? '        <img class="featured-image" src="' + featuredImg + '" alt="' + escapeHtml(article.title) + '">\n' : '') +
    '        <div class="article-body">\n' +
    '            ' + article.content + '\n' +
    '        </div>\n' +
    '        <div class="share-section">\n' +
    '            <span>Share:</span>\n' +
    '            <a href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(article.title) + '&url=https://tokenomic.org/learn/' + article.slug + '" target="_blank" class="share-btn" title="Share on Twitter"><i class="fab fa-twitter"></i></a>\n' +
    '            <a href="https://www.facebook.com/sharer/sharer.php?u=https://tokenomic.org/learn/' + article.slug + '" target="_blank" class="share-btn" title="Share on Facebook"><i class="fab fa-facebook-f"></i></a>\n' +
    '            <a href="https://www.linkedin.com/shareArticle?mini=true&url=https://tokenomic.org/learn/' + article.slug + '&title=' + encodeURIComponent(article.title) + '" target="_blank" class="share-btn" title="Share on LinkedIn"><i class="fab fa-linkedin-in"></i></a>\n' +
    '        </div>\n' +
    '    </div>\n' +
    '</section>\n\n' +
    footerHtml;

  var dir = '_site/learn/' + article.slug;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/index.html', pageHtml);
  console.log('Generated: /learn/' + article.slug + '/');
});

console.log('\nDone! Generated ' + articles.filter(function(a) { return a.content.length >= 50; }).length + ' article pages.');
