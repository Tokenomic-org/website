#!/usr/bin/env node
/**
 * upload-to-ipfs.js
 *
 * Walks the `_site/` directory produced by Jekyll, uploads the entire
 * folder to IPFS via nft.storage, and prints the resulting CID + URLs.
 *
 * Usage:
 *   1. npm install nft.storage files-from-path mime
 *   2. export NFT_STORAGE_API_KEY="<your_key_from_https://nft.storage>"
 *   3. node scripts/upload-to-ipfs.js
 *
 * Optional flags:
 *   --dir <path>   Directory to upload (default: ./_site)
 *   --name <str>   Friendly name attached to the upload (default: tokenomic-<timestamp>)
 *   --json         Print only JSON output (useful for CI)
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { dir: '_site', name: '', json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/upload-to-ipfs.js [--dir _site] [--name label] [--json]');
      process.exit(0);
    }
  }
  return args;
}

function log(args, ...msg) {
  if (!args.json) console.log(...msg);
}

async function main() {
  const args = parseArgs(process.argv);

  const apiKey = process.env.NFT_STORAGE_API_KEY;
  if (!apiKey) {
    console.error('\n[upload-to-ipfs] ERROR: NFT_STORAGE_API_KEY is not set.');
    console.error('  1. Sign in for free at https://nft.storage');
    console.error('  2. Create an API key under "API Keys"');
    console.error('  3. Run: export NFT_STORAGE_API_KEY="<your_key>"\n');
    process.exit(1);
  }

  const absDir = path.resolve(process.cwd(), args.dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    console.error(`\n[upload-to-ipfs] ERROR: directory "${args.dir}" not found.`);
    console.error('  Build the site first with: bundle exec jekyll build\n');
    process.exit(1);
  }

  let NFTStorage, filesFromPath;
  try {
    ({ NFTStorage } = require('nft.storage'));
    ({ filesFromPath } = require('files-from-path'));
  } catch (e) {
    console.error('\n[upload-to-ipfs] ERROR: missing dependencies.');
    console.error('  Run: npm install nft.storage files-from-path mime\n');
    console.error(e.message);
    process.exit(1);
  }

  log(args, '[upload-to-ipfs] Scanning', absDir, '...');
  const files = [];
  for await (const f of filesFromPath(absDir, { pathPrefix: absDir })) {
    files.push(f);
  }
  if (files.length === 0) {
    console.error('[upload-to-ipfs] ERROR: no files found in', absDir);
    process.exit(1);
  }
  log(args, `[upload-to-ipfs] Found ${files.length} files. Uploading to nft.storage...`);

  const client = new NFTStorage({ token: apiKey });
  const started = Date.now();
  const cid = await client.storeDirectory(files);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const result = {
    cid: cid,
    files: files.length,
    uploadSeconds: Number(elapsed),
    name: args.name || `tokenomic-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    urls: {
      cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${cid}/`,
      ipfsIo: `https://ipfs.io/ipfs/${cid}/`,
      dweb: `https://dweb.link/ipfs/${cid}/`,
      nftStorage: `https://${cid}.ipfs.nftstorage.link/`
    },
    dnslink: `dnslink=/ipfs/${cid}`
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n========================================');
    console.log(' Upload complete in ' + elapsed + 's');
    console.log('========================================');
    console.log(' CID: ' + cid);
    console.log(' Files: ' + files.length);
    console.log('');
    console.log(' Public gateways:');
    console.log('   Cloudflare: ' + result.urls.cloudflareGateway);
    console.log('   ipfs.io:    ' + result.urls.ipfsIo);
    console.log('   dweb.link:  ' + result.urls.dweb);
    console.log('   nft.storage:' + result.urls.nftStorage);
    console.log('');
    console.log(' Next steps:');
    console.log('  1. Add this DNS record at your registrar (or Cloudflare DNS):');
    console.log('     Name:  _dnslink.tokenomic.org');
    console.log('     Type:  TXT');
    console.log('     Value: ' + result.dnslink);
    console.log('');
    console.log('  2. Verify after propagation:');
    console.log('     dig +short TXT _dnslink.tokenomic.org');
    console.log('');
    console.log('  3. Visit https://tokenomic.org once your IPFS gateway is live.');
    console.log('========================================\n');
  }

  // Write the latest CID to a file for CI consumption
  try {
    const outFile = path.join(process.cwd(), '.last-ipfs-cid.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    log(args, '[upload-to-ipfs] Wrote ' + outFile);
  } catch (e) {
    log(args, '[upload-to-ipfs] WARN: could not write .last-ipfs-cid.json:', e.message);
  }
}

main().catch((err) => {
  console.error('\n[upload-to-ipfs] FAILED:', err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
