#!/bin/bash
echo "=== Tokenomic Asset Sync ==="
echo ""

echo "1. Syncing CSS files..."
cp assets/css/style.css _site/assets/css/style.css
cp assets/css/dashboard.css _site/assets/css/dashboard.css
cp assets/css/article.css _site/assets/css/article.css
echo "   CSS files synced."

echo "2. Syncing shared JS files..."
cp shared/assets/js/site-search.js _site/shared/assets/js/site-search.js
cp shared/assets/js/supabase-client.js _site/shared/assets/js/supabase-client.js
cp shared/assets/js/web3-wallet.js _site/shared/assets/js/web3-wallet.js
cp shared/assets/js/profile-photo.js _site/shared/assets/js/profile-photo.js 2>/dev/null
echo "   JS files synced."

echo "3. Verifying sync..."
diff <(sed 's/\r$//' _site/assets/css/style.css) <(sed 's/\r$//' assets/css/style.css) > /dev/null 2>&1 && echo "   style.css: OK" || echo "   style.css: OUT OF SYNC"
diff <(sed 's/\r$//' _site/assets/css/dashboard.css) <(sed 's/\r$//' assets/css/dashboard.css) > /dev/null 2>&1 && echo "   dashboard.css: OK" || echo "   dashboard.css: OUT OF SYNC"
diff <(sed 's/\r$//' _site/assets/css/article.css) <(sed 's/\r$//' assets/css/article.css) > /dev/null 2>&1 && echo "   article.css: OK" || echo "   article.css: OUT OF SYNC"
diff <(sed 's/\r$//' _site/shared/assets/js/site-search.js) <(sed 's/\r$//' shared/assets/js/site-search.js) > /dev/null 2>&1 && echo "   site-search.js: OK" || echo "   site-search.js: OUT OF SYNC"
diff <(sed 's/\r$//' _site/shared/assets/js/supabase-client.js) <(sed 's/\r$//' shared/assets/js/supabase-client.js) > /dev/null 2>&1 && echo "   supabase-client.js: OK" || echo "   supabase-client.js: OUT OF SYNC"

echo ""
echo "=== Sync complete ==="
