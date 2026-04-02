var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');

var ARTICLES = [
  { slug: 'iron-condor-butterfly-spread', category: 'Strategy', date: '2025-01-11', author: 'Dr. Sarah Chen' },
  { slug: 'advanced-strategies-in-defi', category: 'Strategy', date: '2025-01-01', author: 'Guillaume Lauzier' },
  { slug: 'arbitrage-a-practical-guide', category: 'Strategy', date: '2024-08-12', author: 'Guillaume Lauzier' },
  { slug: 'case-studies-successful-arbitrage', category: 'Strategy', date: '2024-06-25', author: 'Guillaume Lauzier' },
  { slug: 'smart-contract-security-best-practices', category: 'Technical', date: '2024-12-12', author: 'Guillaume Lauzier' },
  { slug: 'role-of-smart-contracts', category: 'Technical', date: '2024-10-24', author: 'Guillaume Lauzier' },
  { slug: 'fundamentals-building-blockchain', category: 'Technical', date: '2023-07-19', author: 'Guillaume Lauzier' },
  { slug: 'zero-knowledge-proofs', category: 'Technical', date: '2023-03-11', author: 'Guillaume Lauzier' },
  { slug: 'decentralized-data-storage', category: 'Technical', date: '2023-01-07', author: 'Guillaume Lauzier' },
  { slug: 'the-basics-of-defi', category: 'Technical', date: '2023-01-01', author: 'Guillaume Lauzier' },
  { slug: 'analysis-defi-impact-traditional-financial-markets', category: 'Market', date: '2024-07-04', author: 'Guillaume Lauzier' },
  { slug: 'nestor-the-biz-star', category: 'General', date: '2025-07-11', author: 'Guillaume Lauzier' }
];

function fetch(url) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : http;
    mod.get(url, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}

function extractBetween(html, startMarker, endMarker) {
  var startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;
  startIdx += startMarker.length;
  var endIdx = html.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  return html.substring(startIdx, endIdx);
}

function extractTitle(html) {
  var m = html.match(/<title>([^<]+)<\/title>/);
  if (m) {
    var t = m[1].replace(/\s*[–-]\s*Tokenomic\s*$/, '').trim();
    return t;
  }
  var h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return h1 ? h1[1].trim() : 'Untitled';
}

function extractFeaturedImage(html) {
  var m = html.match(/class="lazy"\s+data-src="([^"]+)"/);
  if (m) return m[1];
  m = html.match(/og:image"\s+content="([^"]+)"/);
  return m ? m[1] : null;
}

async function downloadImage(url, destDir) {
  var filename = path.basename(url.split('?')[0]);
  var destPath = path.join(destDir, filename);
  if (fs.existsSync(destPath)) {
    console.log('  Image already exists: ' + filename);
    return filename;
  }
  try {
    var fullUrl = url.startsWith('/') ? 'https://learn.tokenomic.org' + url : url;
    var buffer = await fetch(fullUrl);
    fs.writeFileSync(destPath, buffer);
    console.log('  Downloaded: ' + filename + ' (' + buffer.length + ' bytes)');
    return filename;
  } catch(e) {
    console.error('  Failed to download ' + url + ': ' + e.message);
    return null;
  }
}

async function scrapeArticle(articleMeta) {
  var url = 'https://learn.tokenomic.org/latest/' + articleMeta.slug;
  console.log('Fetching: ' + url);

  try {
    var htmlBuf = await fetch(url);
    var html = htmlBuf.toString('utf-8');

    var title = extractTitle(html);
    var featuredImg = extractFeaturedImage(html);

    var content = extractBetween(html, '<div class="post__content">', '</div>\n\n        <div class="post__share">');
    if (!content) {
      content = extractBetween(html, '<div class="post__content">', '<div class="post__share">');
    }
    if (!content) {
      var m = html.match(/<div class="post__content">([\s\S]*?)<\/div>\s*<div class="post__share">/);
      if (m) content = m[1];
    }

    if (!content) {
      console.error('  Could not extract content for ' + articleMeta.slug);
      return null;
    }

    var imgDir = 'assets/images/learn';
    var images = [];

    if (featuredImg) {
      var fname = await downloadImage(featuredImg, imgDir);
      if (fname) images.push({ original: featuredImg, local: fname });
    }

    var imgMatches = content.match(/src="([^"]+)"/g) || [];
    for (var i = 0; i < imgMatches.length; i++) {
      var src = imgMatches[i].replace('src="', '').replace('"', '');
      if (src.includes('learn.tokenomic.org') || src.startsWith('/images/')) {
        var fname2 = await downloadImage(src, imgDir);
        if (fname2) images.push({ original: src, local: fname2 });
      }
    }

    var localContent = content;
    images.forEach(function(img) {
      if (img.original.startsWith('/')) {
        localContent = localContent.split(img.original).join('/assets/images/learn/' + img.local);
        localContent = localContent.split('https://learn.tokenomic.org' + img.original).join('/assets/images/learn/' + img.local);
      } else {
        localContent = localContent.split(img.original).join('/assets/images/learn/' + img.local);
      }
    });

    return {
      slug: articleMeta.slug,
      title: title,
      category: articleMeta.category,
      date: articleMeta.date,
      author: articleMeta.author,
      featured_image: featuredImg ? '/assets/images/learn/' + images[0].local : null,
      content: localContent.trim(),
      images: images
    };
  } catch(e) {
    console.error('  Error scraping ' + articleMeta.slug + ': ' + e.message);
    return null;
  }
}

async function main() {
  console.log('Starting article scrape...\n');
  var results = [];

  for (var i = 0; i < ARTICLES.length; i++) {
    var result = await scrapeArticle(ARTICLES[i]);
    if (result) {
      results.push(result);
      console.log('  OK: ' + result.title + '\n');
    }
  }

  fs.writeFileSync('scripts/articles-data.json', JSON.stringify(results, null, 2));
  console.log('\nScraped ' + results.length + ' articles. Data saved to scripts/articles-data.json');

  var siteImgDir = '_site/assets/images/learn';
  if (!fs.existsSync(siteImgDir)) fs.mkdirSync(siteImgDir, { recursive: true });
  var srcFiles = fs.readdirSync('assets/images/learn');
  srcFiles.forEach(function(f) {
    fs.copyFileSync('assets/images/learn/' + f, siteImgDir + '/' + f);
  });
  console.log('Copied ' + srcFiles.length + ' images to _site/assets/images/learn/');
}

main().catch(function(e) { console.error(e); process.exit(1); });
