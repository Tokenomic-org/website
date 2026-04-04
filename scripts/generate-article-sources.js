var fs = require('fs');
var path = require('path');

var articles = JSON.parse(fs.readFileSync('scripts/articles-data.json', 'utf-8'));

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

var AUTHOR_PROFILES = {
  'Dr. Sarah Chen': {
    specialty: 'Tokenomics & Economic Design',
    bio: 'PhD in Economics from MIT. Advised 20+ DeFi protocols on tokenomics design and mechanism engineering.',
    avatar: '/assets/images/learn/100.jpg',
    wallet: '0x742d...bD1e'
  },
  'Guillaume Lauzier': {
    specialty: 'DeFi & Technical Implementation',
    bio: 'Founder of and Institutional Educator at Tokenomic, specializing in technical implementation, financial analysis, and digital assets.',
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

function estimateReadingTime(html) {
  var text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  var words = text.split(' ').length;
  return Math.max(1, Math.ceil(words / 200));
}

var learnDir = path.join(__dirname, '..', 'learn');
if (!fs.existsSync(learnDir)) {
  fs.mkdirSync(learnDir, { recursive: true });
}

var count = 0;

articles.forEach(function(article) {
  if (article.content.length < 50) {
    console.log('Skipping ' + article.slug + ' (no content)');
    return;
  }

  var authorName = AUTHOR_MAP[article.slug] || article.author;
  var profile = AUTHOR_PROFILES[authorName] || {};
  var featuredImg = IMAGE_MAP[article.slug]
    ? '/assets/images/learn/' + IMAGE_MAP[article.slug]
    : article.featured_image;
  var readingTime = estimateReadingTime(article.content);

  var frontMatter = '---\n';
  frontMatter += 'layout: article\n';
  frontMatter += 'title: "' + article.title.replace(/"/g, '\\"') + '"\n';
  frontMatter += 'slug: ' + article.slug + '\n';
  frontMatter += 'category: ' + article.category + '\n';
  frontMatter += 'date: ' + article.date + '\n';
  frontMatter += 'author: "' + authorName.replace(/"/g, '\\"') + '"\n';
  frontMatter += 'featured_image: ' + featuredImg + '\n';
  frontMatter += 'reading_time: ' + readingTime + '\n';
  frontMatter += 'permalink: /learn/' + article.slug + '/\n';

  if (profile.specialty) {
    frontMatter += 'author_specialty: "' + profile.specialty.replace(/"/g, '\\"') + '"\n';
  }
  if (profile.bio) {
    frontMatter += 'author_bio: "' + profile.bio.replace(/"/g, '\\"') + '"\n';
  }
  if (profile.avatar) {
    frontMatter += 'author_avatar: ' + profile.avatar + '\n';
  }
  if (profile.wallet) {
    frontMatter += 'author_wallet: ' + profile.wallet + '\n';
  }

  frontMatter += '---\n';

  var fileContent = frontMatter + article.content;

  var filePath = path.join(learnDir, article.slug + '.html');
  fs.writeFileSync(filePath, fileContent);
  count++;
  console.log('Generated: learn/' + article.slug + '.html');
});

console.log('\nDone! Generated ' + count + ' article source files in learn/');
