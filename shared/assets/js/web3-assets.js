var __TKN_ENV = (typeof window !== 'undefined' && window.__TKN_ENV) || {};

var TokenomicAssets = {
  BASE_CHAIN_ID: Number(__TKN_ENV.BASE_CHAIN_ID || 8453),
  BASE_CHAIN_HEX: '0x' + Number(__TKN_ENV.BASE_CHAIN_ID || 8453).toString(16),
  BASE_RPC: __TKN_ENV.BASE_RPC_URL || 'https://mainnet.base.org',
  ETH_GATEWAY: __TKN_ENV.ETH_GATEWAY_URL || '',
  BASESCAN_BASE: __TKN_ENV.BASESCAN_BASE || 'https://basescan.org',
  USDC_ADDRESS: __TKN_ENV.USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

  // New contracts from Prompt 5 (TokenomicMarket / TokenomicCertificate).
  // Set via window.__TKN_ENV.MARKET_CONTRACT and CERTIFICATE_CONTRACT.
  MARKET_ADDRESS: __TKN_ENV.MARKET_CONTRACT || null,
  CERT_NFT_ADDRESS: __TKN_ENV.CERTIFICATE_CONTRACT || null,

  // Legacy slots (kept for backward compatibility)
  REVENUE_SPLITTER_ADDRESS: null,
  COURSE_NFT_ADDRESS: null,

  // TokenomicMarket ABI (subset used by the frontend)
  MARKET_ABI: [
    'function purchase(uint256 courseId)',
    'function claimCertificate(uint256 courseId, string ipfsMetadataURI) returns (uint256)',
    'function registerCourse(string ipfsMetadataURI, uint256 priceInUSDC, address consultant) returns (uint256)',
    'function withdrawUSDC() returns (uint256)',
    'function withdrawPlatformFees(address to) returns (uint256)',
    'function getCourse(uint256 courseId) view returns (tuple(address educator, address consultant, uint256 price, bool active))',
    'function getCourseMetadataURI(uint256 courseId) view returns (string)',
    'function getCoursesByEducator(address educator) view returns (uint256[])',
    'function getRegisteredCourseIds() view returns (uint256[])',
    'function pendingWithdrawals(address) view returns (uint256)',
    'function totalEarned(address) view returns (uint256)',
    'function platformBalance() view returns (uint256)',
    'function hasPurchased(uint256 courseId, address user) view returns (bool)',
    'function certificateOf(uint256 courseId, address user) view returns (uint256)',
    'function quoteSplit(uint256 price, bool hasConsultant) pure returns (uint256, uint256, uint256)',
    'event CoursePurchased(uint256 indexed courseId, address indexed buyer, uint256 totalPaid, uint256 educatorAmount, uint256 consultantAmount, uint256 platformAmount, uint256 certificateTokenId)',
    'event CourseRegistered(uint256 indexed courseId, address indexed educator, address consultant, uint256 price, string ipfsMetadataURI)',
    'event PurchaseSettled(uint256 indexed courseId, address indexed buyer, address indexed educator, address consultant, uint256 educatorAmount, uint256 consultantAmount, uint256 platformAmount, uint256 certificateTokenId, string ipfsMetadataURI)',
    'event CertificateClaimed(uint256 indexed courseId, address indexed buyer, uint256 certificateTokenId, string ipfsMetadataURI)',
    'event Withdrawn(address indexed account, uint256 amount)'
  ],
  // TokenomicCertificate ABI (subset for reads + legacy fallback mint)
  CERT_NFT_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function tokenIdToCourseId(uint256 tokenId) view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function safeMint(address to, string memory tokenURI) public returns (uint256)'
  ],
  REVENUE_SPLITTER_ABI: [
    'function claim() external',
    'function claimable(address account) view returns (uint256)',
    'function totalClaimed(address account) view returns (uint256)'
  ],
  COURSE_NFT_ABI: [
    'function mint(address to, uint256 courseId, uint256 amount, bytes data) public',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function uri(uint256 id) view returns (string)'
  ],
  USDC_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)'
  ],

  _assets: null,
  _ownershipProof: null,

  getWallet: function() {
    if (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.account) {
      return TokenomicWallet.account;
    }
    return sessionStorage.getItem('tkn_wallet') || null;
  },

  getRole: function() {
    try {
      var data = JSON.parse(localStorage.getItem('tkn_profile_data') || '{}');
      return (data.role || 'Student').toLowerCase();
    } catch (e) {
      return 'student';
    }
  },

  isEducator: function() {
    var role = this.getRole();
    return role === 'educator' || role === 'institution admin';
  },

  isConsultant: function() {
    return this.getRole() === 'consultant';
  },

  isLearner: function() {
    return this.getRole() === 'student';
  },

  isCreator: function() {
    return this.isEducator() || this.isConsultant();
  },

  async ensureBaseChain() {
    if (!window.ethereum) return false;
    try {
      var chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== this.BASE_CHAIN_HEX) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: this.BASE_CHAIN_HEX }]
          });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: this.BASE_CHAIN_HEX,
                chainName: 'Base',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://mainnet.base.org'],
                blockExplorerUrls: ['https://basescan.org']
              }]
            });
          } else {
            throw switchErr;
          }
        }
      }
      return true;
    } catch (e) {
      console.error('Chain switch failed:', e);
      return false;
    }
  },

  async signOwnershipProof() {
    var wallet = this.getWallet();
    if (!wallet || !window.ethereum) {
      throw new Error('Wallet not connected');
    }

    var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
    var timestamp = Date.now();
    var nonce = Math.random().toString(36).substring(2, 10);
    var domain = window.location.host || 'tokenomic.org';

    var message = 'Tokenomic Ownership Verification\n\n' +
      'Domain: ' + domain + '\n' +
      'Address: ' + wallet + '\n' +
      'Chain: Base (8453)\n' +
      'Nonce: ' + nonce + '\n' +
      'Timestamp: ' + new Date(timestamp).toISOString() + '\n\n' +
      'By signing this message, you confirm ownership of this wallet and authorize Tokenomic to link it to your account.';

    var signature = await eth.request({
      method: 'personal_sign',
      params: [message, wallet]
    });

    this._ownershipProof = {
      wallet: wallet,
      message: message,
      signature: signature,
      timestamp: timestamp,
      nonce: nonce
    };

    try {
      var resp = await fetch('/api/verify-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._ownershipProof)
      });
      var result = await resp.json();
      if (result.verified) {
        localStorage.setItem('tkn_ownership_proof', JSON.stringify({
          wallet: wallet,
          verified: true,
          timestamp: timestamp,
          expiresAt: timestamp + (24 * 60 * 60 * 1000)
        }));
      }
      return result;
    } catch (e) {
      console.error('Verification request failed:', e);
      return { verified: false, error: e.message };
    }
  },

  isOwnershipVerified: function() {
    try {
      var proof = JSON.parse(localStorage.getItem('tkn_ownership_proof') || '{}');
      var wallet = this.getWallet();
      if (!proof.verified || !wallet) return false;
      if (proof.wallet.toLowerCase() !== wallet.toLowerCase()) return false;
      if (proof.expiresAt && Date.now() > proof.expiresAt) return false;
      return true;
    } catch (e) {
      return false;
    }
  },

  async getUSDCBalance() {
    var wallet = this.getWallet();
    if (!wallet || typeof ethers === 'undefined') return '0.00';
    try {
      var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
      var provider = new ethers.providers.Web3Provider(eth);
      var usdc = new ethers.Contract(this.USDC_ADDRESS, this.USDC_ABI, provider);
      var balance = await usdc.balanceOf(wallet);
      return ethers.utils.formatUnits(balance, 6);
    } catch (e) {
      console.error('USDC balance error:', e);
      return '0.00';
    }
  },

  async getETHBalance() {
    var wallet = this.getWallet();
    if (!wallet || typeof ethers === 'undefined') return '0.0000';
    try {
      var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
      var provider = new ethers.providers.Web3Provider(eth);
      var balance = await provider.getBalance(wallet);
      return parseFloat(ethers.utils.formatEther(balance)).toFixed(4);
    } catch (e) {
      return '0.0000';
    }
  },

  async loadAssets() {
    var wallet = this.getWallet();
    if (!wallet) return { courses: [], certifications: [], revenue: [], articles: [] };

    try {
      var resp = await fetch('/api/assets/' + wallet);
      if (resp.ok) {
        this._assets = await resp.json();
        return this._assets;
      }
    } catch (e) {
      console.warn('Could not fetch assets from server:', e);
    }

    var stored = localStorage.getItem('tkn_assets_' + wallet.toLowerCase());
    if (stored) {
      try {
        this._assets = JSON.parse(stored);
        return this._assets;
      } catch (e) {}
    }

    this._assets = { courses: [], certifications: [], revenue: [], articles: [] };
    return this._assets;
  },

  _saveLocalAssets: function(wallet, assets) {
    try {
      localStorage.setItem('tkn_assets_' + wallet.toLowerCase(), JSON.stringify(assets));
    } catch (e) {}
  },

  async registerAsset(assetData) {
    var wallet = this.getWallet();
    if (!wallet) throw new Error('Wallet not connected');

    var asset = {
      id: 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      owner_wallet: wallet,
      type: assetData.type,
      title: assetData.title,
      description: assetData.description || '',
      metadata_uri: assetData.metadata_uri || '',
      tx_hash: assetData.tx_hash || null,
      token_id: assetData.token_id || null,
      contract_address: assetData.contract_address || null,
      chain_id: this.BASE_CHAIN_ID,
      created_at: new Date().toISOString(),
      status: assetData.status || 'registered'
    };

    try {
      var resp = await fetch('/api/assets/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asset)
      });
      if (resp.ok) {
        var result = await resp.json();
        await this.loadAssets();
        return result;
      }
    } catch (e) {
      console.warn('Server register failed, saving locally:', e);
    }

    if (!this._assets) await this.loadAssets();
    var key = asset.type === 'course' ? 'courses' :
              asset.type === 'certification' ? 'certifications' :
              asset.type === 'article' ? 'articles' : 'courses';
    this._assets[key].push(asset);
    this._saveLocalAssets(wallet, this._assets);
    return asset;
  },

  async tokenizeCourse(courseData) {
    var wallet = this.getWallet();
    if (!wallet) throw new Error('Wallet not connected');

    await this.ensureBaseChain();

    var asset = await this.registerAsset({
      type: 'course',
      title: courseData.title,
      description: courseData.description || '',
      status: 'tokenized'
    });

    if (this.COURSE_NFT_ADDRESS && typeof ethers !== 'undefined') {
      try {
        var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
        var provider = new ethers.providers.Web3Provider(eth);
        var signer = provider.getSigner();
        var contract = new ethers.Contract(this.COURSE_NFT_ADDRESS, this.COURSE_NFT_ABI, signer);
        var tx = await contract.mint(wallet, courseData.courseId || 0, 1, '0x');
        asset.tx_hash = tx.hash;
        asset.status = 'minting';

        var receipt = await tx.wait();
        asset.status = 'on_chain';
        asset.tx_hash = receipt.transactionHash;

        await this.registerAsset(asset);
        return { success: true, asset: asset, txHash: receipt.transactionHash };
      } catch (e) {
        console.error('On-chain mint failed:', e);
        return { success: true, asset: asset, onChain: false, error: e.message };
      }
    }

    return { success: true, asset: asset, onChain: false, note: 'Course registered off-chain. Deploy contract to tokenize on Base.' };
  },

  async mintCertification(certData) {
    var wallet = this.getWallet();
    if (!wallet) throw new Error('Wallet not connected');

    await this.ensureBaseChain();

    var metadataUri = certData.metadata_uri || 'ipfs://pending';

    if (this.CERT_NFT_ADDRESS && typeof ethers !== 'undefined') {
      try {
        var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
        var provider = new ethers.providers.Web3Provider(eth);
        var signer = provider.getSigner();
        var contract = new ethers.Contract(this.CERT_NFT_ADDRESS, this.CERT_NFT_ABI, signer);
        var tx = await contract.safeMint(wallet, metadataUri);
        var receipt = await tx.wait();

        var asset = await this.registerAsset({
          type: 'certification',
          title: certData.courseTitle || 'Course Certification',
          description: 'Completed: ' + (certData.courseTitle || 'Course'),
          metadata_uri: metadataUri,
          tx_hash: receipt.transactionHash,
          contract_address: this.CERT_NFT_ADDRESS,
          status: 'on_chain'
        });

        return {
          success: true,
          asset: asset,
          txHash: receipt.transactionHash,
          explorerUrl: 'https://basescan.org/tx/' + receipt.transactionHash
        };
      } catch (e) {
        console.error('Cert mint failed:', e);
        throw e;
      }
    }

    var asset = await this.registerAsset({
      type: 'certification',
      title: certData.courseTitle || 'Course Certification',
      description: 'Completed: ' + (certData.courseTitle || 'Course'),
      metadata_uri: metadataUri,
      status: 'pending_contract'
    });

    return { success: true, asset: asset, onChain: false, note: 'Certification recorded. Deploy ERC-721 contract on Base to mint NFT.' };
  },

  async claimRevenue() {
    var wallet = this.getWallet();
    if (!wallet) throw new Error('Wallet not connected');

    await this.ensureBaseChain();

    if (this.REVENUE_SPLITTER_ADDRESS && typeof ethers !== 'undefined') {
      try {
        var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
        var provider = new ethers.providers.Web3Provider(eth);
        var signer = provider.getSigner();
        var contract = new ethers.Contract(this.REVENUE_SPLITTER_ADDRESS, this.REVENUE_SPLITTER_ABI, signer);
        var tx = await contract.claim();
        var receipt = await tx.wait();

        await this.registerAsset({
          type: 'revenue_claim',
          title: 'Revenue Claim',
          description: 'Claimed revenue share',
          tx_hash: receipt.transactionHash,
          contract_address: this.REVENUE_SPLITTER_ADDRESS,
          status: 'claimed'
        });

        return {
          success: true,
          txHash: receipt.transactionHash,
          explorerUrl: 'https://basescan.org/tx/' + receipt.transactionHash
        };
      } catch (e) {
        console.error('Claim failed:', e);
        throw e;
      }
    }

    return { success: false, note: 'Revenue splitter contract not deployed. Set REVENUE_SPLITTER_ADDRESS to enable on-chain claims.' };
  },

  async getClaimableRevenue() {
    var wallet = this.getWallet();
    if (!wallet || !this.REVENUE_SPLITTER_ADDRESS || typeof ethers === 'undefined') return '0.00';
    try {
      var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
      var provider = new ethers.providers.Web3Provider(eth);
      var contract = new ethers.Contract(this.REVENUE_SPLITTER_ADDRESS, this.REVENUE_SPLITTER_ABI, provider);
      var amount = await contract.claimable(wallet);
      return ethers.utils.formatUnits(amount, 6);
    } catch (e) {
      return '0.00';
    }
  },

  getAssetsByType: function(type) {
    if (!this._assets) return [];
    if (type === 'course') return this._assets.courses || [];
    if (type === 'certification') return this._assets.certifications || [];
    if (type === 'article') return this._assets.articles || [];
    if (type === 'revenue') return this._assets.revenue || [];
    return [];
  },

  getExplorerUrl: function(txHash) {
    if (!txHash) return '';
    return 'https://basescan.org/tx/' + txHash;
  },

  getAddressUrl: function(address) {
    if (!address) return '';
    return 'https://basescan.org/address/' + address;
  },

  getSummary: function() {
    if (!this._assets) return { totalAssets: 0, courses: 0, certifications: 0, articles: 0 };
    return {
      totalAssets: (this._assets.courses || []).length + (this._assets.certifications || []).length + (this._assets.articles || []).length,
      courses: (this._assets.courses || []).length,
      certifications: (this._assets.certifications || []).length,
      articles: (this._assets.articles || []).length
    };
  },

  hasCourseAccess: function(courseId) {
    if (!this._assets) return false;
    var owned = (this._assets.courses || []).concat(this._assets.certifications || []);
    var idStr = String(courseId);
    return owned.some(function(a) {
      return String(a.course_id || a.courseId || '') === idStr ||
             (a.metadata && String(a.metadata.course_id || '') === idStr);
    });
  },

  async buyCourse(courseId, priceInUSDC, opts) {
    opts = opts || {};
    var wallet = this.getWallet();
    if (!wallet) {
      if (typeof TokenomicWallet !== 'undefined') await TokenomicWallet.connect();
      wallet = this.getWallet();
      if (!wallet) throw new Error('Wallet not connected');
    }

    var priceNum = Number(priceInUSDC);
    if (!isFinite(priceNum) || priceNum < 0) {
      throw new Error('Invalid price: ' + priceInUSDC);
    }

    if (priceNum === 0) {
      var freeAsset = await this.registerAsset({
        type: 'course',
        title: opts.title || 'Free Course',
        description: 'Enrolled in free course',
        status: 'enrolled'
      });
      freeAsset.course_id = courseId;
      return { success: true, asset: freeAsset, free: true };
    }

    await this.ensureBaseChain();

    if (typeof ethers === 'undefined') throw new Error('ethers library not loaded');

    var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
    var provider = new ethers.providers.Web3Provider(eth);
    var signer = provider.getSigner();
    var usdc = new ethers.Contract(this.USDC_ADDRESS, this.USDC_ABI, signer);
    var amount = ethers.utils.parseUnits(priceNum.toFixed(6), 6);

    // ---- Path A: TokenomicMarket configured -> approve + purchase (mints cert atomically) ----
    if (this.MARKET_ADDRESS) {
      var market = new ethers.Contract(this.MARKET_ADDRESS, this.MARKET_ABI, signer);

      var allowance;
      try { allowance = await usdc.allowance(wallet, this.MARKET_ADDRESS); }
      catch (e) { allowance = ethers.BigNumber.from(0); }

      if (allowance.lt(amount)) {
        var approveTx = await usdc.approve(this.MARKET_ADDRESS, amount);
        await approveTx.wait();
      }

      var ipfsURI = this._buildCertificateMetadataURI(courseId, opts.title || ('Course #' + courseId), wallet);
      // NOTE: certificate is no longer minted atomically. Buyer pays gas for `claimCertificate`
      // separately after this purchase confirms. See `claimCertificate(courseId)` below.
      var purchaseTx = await market.purchase(courseId);
      var receipt = await purchaseTx.wait();

      var asset = await this.registerAsset({
        type: 'course',
        title: opts.title || ('Course #' + courseId),
        description: 'Purchased for ' + priceInUSDC + ' USDC (on-chain)',
        tx_hash: receipt.transactionHash,
        contract_address: this.MARKET_ADDRESS,
        token_id: null,
        metadata_uri: ipfsURI,
        status: 'purchased'
      });
      asset.course_id = courseId;

      return {
        success: true,
        asset: asset,
        txHash: receipt.transactionHash,
        certificateTokenId: null,
        certificateMetadataURI: ipfsURI,
        explorerUrl: this.BASESCAN_BASE + '/tx/' + receipt.transactionHash,
        certificateMinted: false,
        certificateClaimable: true,
        note: 'Purchase confirmed. Click "Claim Certificate" to mint your NFT (you pay the gas).'
      };
    }

    // ---- Path B: legacy USDC transfer to splitter (until contracts deployed) ----
    var recipient = opts.recipient || this.REVENUE_SPLITTER_ADDRESS;
    if (!recipient) {
      throw new Error('No payment recipient configured. Set MARKET_CONTRACT (preferred) or REVENUE_SPLITTER_ADDRESS in window.__TKN_ENV.');
    }
    var tx = await usdc.transfer(recipient, amount);
    var receipt2 = await tx.wait();
    var asset2 = await this.registerAsset({
      type: 'course',
      title: opts.title || ('Course #' + courseId),
      description: 'Purchased for ' + priceInUSDC + ' USDC',
      tx_hash: receipt2.transactionHash,
      contract_address: this.USDC_ADDRESS,
      status: 'purchased'
    });
    asset2.course_id = courseId;
    return {
      success: true,
      asset: asset2,
      txHash: receipt2.transactionHash,
      explorerUrl: this.BASESCAN_BASE + '/tx/' + receipt2.transactionHash
    };
  },

  _buildCertificateMetadataURI: function(courseId, title, wallet) {
    // Deterministic placeholder URI. Replace with real pinning (Worker -> nft.storage)
    // for production. The on-chain mint stores whatever string we pass here.
    var base = (typeof __TKN_ENV !== 'undefined' && __TKN_ENV.CERT_METADATA_BASE) || 'ipfs://tokenomic/certificates';
    var safe = String(title || '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 64).toLowerCase() || 'cert';
    return base + '/' + safe + '-' + courseId + '-' + (wallet ? wallet.slice(2, 10).toLowerCase() : 'anon') + '.json';
  },

  /**
   * Mint the certificate NFT for a course the connected wallet has purchased.
   * Calls TokenomicMarket.claimCertificate(courseId, ipfsMetadataURI) — student pays gas.
   */
  async claimCertificate(courseId, opts) {
    opts = opts || {};
    var wallet = this.getWallet();
    if (!wallet) {
      if (typeof TokenomicWallet !== 'undefined') await TokenomicWallet.connect();
      wallet = this.getWallet();
      if (!wallet) throw new Error('Wallet not connected');
    }

    // Path A: TokenomicMarket configured -> on-chain student-paid mint via market.claimCertificate
    if (this.MARKET_ADDRESS) {
      await this.ensureBaseChain();
      var market = await this._getMarketSigner();

      // Idempotency: if already claimed, surface the existing tokenId without a fresh mint.
      try {
        var existing = await market.certificateOf(courseId, wallet);
        if (existing && existing.toString && existing.toString() !== '0') {
          return {
            success: true,
            alreadyMinted: true,
            certificateTokenId: existing.toString(),
            note: 'Certificate already claimed for this course.'
          };
        }
      } catch (_) { /* best-effort read */ }

      var ipfsURI = opts.metadata_uri || this._buildCertificateMetadataURI(courseId, opts.title || ('Course #' + courseId), wallet);
      var tx = await market.claimCertificate(courseId, ipfsURI);
      var receipt = await tx.wait();

      var tokenId = null;
      try {
        var iface = new ethers.utils.Interface(this.MARKET_ABI);
        for (var i = 0; i < (receipt.logs || []).length; i++) {
          try {
            var parsed = iface.parseLog(receipt.logs[i]);
            if (parsed && parsed.name === 'CertificateClaimed') {
              tokenId = parsed.args.certificateTokenId.toString();
              break;
            }
          } catch (_) { /* not our log */ }
        }
      } catch (_) {}

      return {
        success: true,
        certificateTokenId: tokenId,
        metadataURI: ipfsURI,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed && receipt.gasUsed.toString ? receipt.gasUsed.toString() : null,
        explorerUrl: this.BASESCAN_BASE + '/tx/' + receipt.transactionHash,
        note: 'Certificate minted. You paid the gas for this transaction.'
      };
    }

    // Path B: legacy fallback — direct cert contract mint (kept for back-compat tests).
    var result = await this.mintCertification({
      courseTitle: opts.title || ('Course #' + courseId),
      metadata_uri: opts.metadata_uri || this._buildCertificateMetadataURI(courseId, opts.title, wallet)
    });
    if (result && result.asset) result.asset.course_id = courseId;
    return result;
  },

  /**
   * Estimate gas + ETH cost (in wei + decimal ETH) for an action before the user signs.
   * Returns { gas, gasPrice, ethCost, ethCostFormatted } or { error } if estimation failed.
   * action ∈ { 'purchase' | 'claim' | 'register' | 'withdraw' }
   * params: { courseId?, ipfsMetadataURI?, priceInUSDC?, consultant? }
   */
  async estimateActionGas(action, params) {
    params = params || {};
    if (typeof ethers === 'undefined') return { error: 'ethers not loaded' };
    if (!this.MARKET_ADDRESS) return { error: 'Market contract not configured' };
    try {
      await this.ensureBaseChain();
      var market = await this._getMarketSigner();
      var provider = market.signer ? market.signer.provider : market.provider;

      var gas;
      if (action === 'purchase') {
        gas = await market.estimateGas.purchase(params.courseId);
      } else if (action === 'claim') {
        var uri = params.ipfsMetadataURI || this._buildCertificateMetadataURI(params.courseId, params.title, this.getWallet());
        gas = await market.estimateGas.claimCertificate(params.courseId, uri);
      } else if (action === 'register') {
        var priceWei = ethers.utils.parseUnits(String(params.priceInUSDC || '0'), 6);
        var addr = params.consultant && /^0x[0-9a-fA-F]{40}$/.test(params.consultant)
          ? params.consultant : '0x0000000000000000000000000000000000000000';
        gas = await market.estimateGas.registerCourse(params.ipfsMetadataURI || '', priceWei, addr);
      } else if (action === 'withdraw') {
        gas = await market.estimateGas.withdrawUSDC();
      } else {
        return { error: 'unknown action' };
      }

      var gasPrice;
      try { gasPrice = await provider.getGasPrice(); }
      catch (_) { gasPrice = ethers.BigNumber.from('1000000'); /* 0.001 gwei fallback for Base */ }

      var ethCost = gas.mul(gasPrice);
      return {
        gas: gas.toString(),
        gasPrice: gasPrice.toString(),
        ethCost: ethCost.toString(),
        ethCostFormatted: ethers.utils.formatEther(ethCost),
        message: 'You will pay ~' + Number(ethers.utils.formatEther(ethCost)).toFixed(6) + ' ETH on Base for this action.'
      };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  /**
   * Fetch every certificate NFT owned by `address` from TokenomicCertificate.
   * Walks tokenIds 1..nextTokenId-1 and filters by ownerOf, since the
   * production contract intentionally omits ERC721Enumerable to save gas.
   */
  async getOwnedCertificates(address) {
    if (!this.CERT_NFT_ADDRESS) return [];
    if (typeof ethers === 'undefined') throw new Error('ethers library not loaded');
    var rpcUrl = this.ETH_GATEWAY || this.BASE_RPC;
    var provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    var cert = new ethers.Contract(this.CERT_NFT_ADDRESS, this.CERT_NFT_ABI.concat(['function nextTokenId() view returns (uint256)']), provider);

    var balance;
    try { balance = await cert.balanceOf(address); }
    catch (e) { return []; }
    var bal = balance && balance.toNumber ? balance.toNumber() : Number(balance || 0);
    if (bal === 0) return [];

    var maxId;
    try { maxId = (await cert.nextTokenId()).toNumber(); }
    catch (e) { maxId = 200; /* defensive cap */ }
    var owned = [];
    var checked = 0;
    var maxScan = Math.min(maxId, 1000);
    for (var id = 1; id < maxScan && owned.length < bal && checked < maxScan; id++) {
      checked++;
      try {
        var owner = await cert.ownerOf(id);
        if (owner.toLowerCase() === address.toLowerCase()) {
          var uri = '';
          var courseId = null;
          try { uri = await cert.tokenURI(id); } catch (_) {}
          try { courseId = (await cert.tokenIdToCourseId(id)).toString(); } catch (_) {}
          owned.push({
            tokenId: String(id),
            courseId: courseId,
            tokenURI: uri,
            ipfsUrl: uri && uri.indexOf('ipfs://') === 0
              ? 'https://cloudflare-ipfs.com/ipfs/' + uri.slice('ipfs://'.length)
              : uri,
            contract: this.CERT_NFT_ADDRESS,
            explorerUrl: this.BASESCAN_BASE + '/token/' + this.CERT_NFT_ADDRESS + '?a=' + id
          });
        }
      } catch (_) { /* token may not exist; keep scanning */ }
    }
    return owned;
  },

  // ===================================================================
  // Educator / consultant on-chain helpers
  // ===================================================================

  _getReadProvider: function() {
    if (typeof ethers === 'undefined') throw new Error('ethers library not loaded');
    return new ethers.providers.JsonRpcProvider(this.ETH_GATEWAY || this.BASE_RPC);
  },

  _getMarketSigner: async function() {
    if (typeof ethers === 'undefined') throw new Error('ethers library not loaded');
    if (!this.MARKET_ADDRESS) throw new Error('MARKET_CONTRACT not configured');
    var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
    if (!eth) throw new Error('No injected wallet');
    var provider = new ethers.providers.Web3Provider(eth);
    var signer = provider.getSigner();
    return new ethers.Contract(this.MARKET_ADDRESS, this.MARKET_ABI, signer);
  },

  _getMarketReadOnly: function() {
    if (!this.MARKET_ADDRESS) return null;
    return new ethers.Contract(this.MARKET_ADDRESS, this.MARKET_ABI, this._getReadProvider());
  },

  /** Returns { pending, totalEarned } in USDC base units (BigNumber). */
  async getEducatorEarnings(address) {
    var market = this._getMarketReadOnly();
    if (!market) return { pending: '0', totalEarned: '0' };
    var pending = await market.pendingWithdrawals(address);
    var earned  = await market.totalEarned(address);
    return {
      pending: pending.toString(),
      totalEarned: earned.toString(),
      pendingFormatted: ethers.utils.formatUnits(pending, 6),
      totalEarnedFormatted: ethers.utils.formatUnits(earned, 6)
    };
  },

  /** Returns array of {courseId, price, active, consultant, metadataURI}. */
  async getEducatorCourses(address) {
    var market = this._getMarketReadOnly();
    if (!market) return [];
    var ids;
    try { ids = await market.getCoursesByEducator(address); }
    catch (e) { return []; }
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      try {
        var c = await market.getCourse(id);
        var uri = '';
        try { uri = await market.getCourseMetadataURI(id); } catch (_) {}
        out.push({
          courseId: id.toString(),
          educator: c.educator,
          consultant: c.consultant,
          price: c.price.toString(),
          priceFormatted: ethers.utils.formatUnits(c.price, 6),
          active: c.active,
          metadataURI: uri,
          ipfsUrl: uri && uri.indexOf('ipfs://') === 0
            ? 'https://cloudflare-ipfs.com/ipfs/' + uri.slice('ipfs://'.length)
            : uri
        });
      } catch (_) {}
    }
    return out;
  },

  /**
   * Query PurchaseSettled events filtered by educator address.
   * Returns array of normalized sale records (newest first).
   */
  async getEducatorSales(address, opts) {
    opts = opts || {};
    var market = this._getMarketReadOnly();
    if (!market) return [];
    var fromBlock = opts.fromBlock || 0;
    try {
      var filter = market.filters.PurchaseSettled(null, null, address);
      var events = await market.queryFilter(filter, fromBlock, 'latest');
      return events.map(function(ev) {
        var a = ev.args;
        return {
          courseId: a.courseId.toString(),
          buyer: a.buyer,
          consultant: a.consultant,
          educatorAmount: ethers.utils.formatUnits(a.educatorAmount, 6),
          consultantAmount: ethers.utils.formatUnits(a.consultantAmount, 6),
          platformAmount: ethers.utils.formatUnits(a.platformAmount, 6),
          certificateTokenId: a.certificateTokenId.toString(),
          ipfsMetadataURI: a.ipfsMetadataURI,
          txHash: ev.transactionHash,
          blockNumber: ev.blockNumber,
          explorerUrl: this.BASESCAN_BASE + '/tx/' + ev.transactionHash
        };
      }.bind(this)).reverse();
    } catch (e) {
      console.warn('getEducatorSales failed:', e);
      return [];
    }
  },

  /** Withdraw the connected wallet's pending USDC. Returns receipt + amount. */
  async withdrawEarnings() {
    await this.ensureBaseChain();
    var market = await this._getMarketSigner();
    var tx = await market.withdrawUSDC();
    var receipt = await tx.wait();
    var amount = '0';
    try {
      var iface = new ethers.utils.Interface(this.MARKET_ABI);
      for (var i = 0; i < (receipt.logs || []).length; i++) {
        try {
          var p = iface.parseLog(receipt.logs[i]);
          if (p && p.name === 'Withdrawn') { amount = ethers.utils.formatUnits(p.args.amount, 6); break; }
        } catch (_) {}
      }
    } catch (_) {}
    return { txHash: receipt.transactionHash, amount: amount, explorerUrl: this.BASESCAN_BASE + '/tx/' + receipt.transactionHash };
  },

  /**
   * Register a course on-chain. Caller becomes the educator.
   * @param {string} ipfsMetadataURI - Content URI: `ipfs://Qm...` (legacy) or
   *                                   `stream:<cloudflare-stream-uid>` (current).
   * @param {string|number} priceInUSDC - Human-readable USDC (e.g. "49.99").
   * @param {string} consultant - Optional address (use ethers.constants.AddressZero for none).
   */
  async registerCourseOnChain(ipfsMetadataURI, priceInUSDC, consultant) {
    await this.ensureBaseChain();
    var market = await this._getMarketSigner();
    if (!ipfsMetadataURI ||
        (ipfsMetadataURI.indexOf('ipfs://')  !== 0 &&
         ipfsMetadataURI.indexOf('stream:')  !== 0 &&
         ipfsMetadataURI.indexOf('https://') !== 0)) {
      throw new Error('content URI must start with ipfs://, stream:, or https://');
    }
    var priceWei = ethers.utils.parseUnits(String(priceInUSDC), 6);
    var addr = consultant && /^0x[0-9a-fA-F]{40}$/.test(consultant)
      ? consultant
      : '0x0000000000000000000000000000000000000000';
    var tx = await market.registerCourse(ipfsMetadataURI, priceWei, addr);
    var receipt = await tx.wait();
    var courseId = null;
    try {
      var iface = new ethers.utils.Interface(this.MARKET_ABI);
      for (var i = 0; i < (receipt.logs || []).length; i++) {
        try {
          var p = iface.parseLog(receipt.logs[i]);
          if (p && p.name === 'CourseRegistered') { courseId = p.args.courseId.toString(); break; }
        } catch (_) {}
      }
    } catch (_) {}
    return {
      courseId: courseId,
      txHash: receipt.transactionHash,
      explorerUrl: this.BASESCAN_BASE + '/tx/' + receipt.transactionHash
    };
  },

  /**
   * Compute a simple Tokenomic Score for an address from on-chain signals:
   *   score = ownedCertificates * 10
   *         + lifetimePurchases * 5
   *         + min(50, log10(totalEarnedUSDC + 1) * 20)
   * Returns { score, breakdown }. Pure read; safe to call without a wallet connection.
   */
  async getTokenomicScore(address) {
    var breakdown = {
      ownedCertificates: 0,
      lifetimePurchases: 0,
      totalEarnedUSDC: 0,
      coursesRegistered: 0
    };
    if (!address) return { score: 0, breakdown: breakdown };

    try {
      var owned = await this.getOwnedCertificates(address);
      breakdown.ownedCertificates = owned.length;
    } catch (_) {}

    var market = this._getMarketReadOnly();
    if (market) {
      try {
        var earned = await market.totalEarned(address);
        breakdown.totalEarnedUSDC = parseFloat(ethers.utils.formatUnits(earned, 6));
      } catch (_) {}
      try {
        var courses = await market.getCoursesByEducator(address);
        breakdown.coursesRegistered = courses.length;
      } catch (_) {}
      try {
        var f = market.filters.CoursePurchased(null, address);
        var evs = await market.queryFilter(f, 0, 'latest');
        breakdown.lifetimePurchases = evs.length;
      } catch (_) {}
    }

    var earnings = Math.min(50, Math.log10(breakdown.totalEarnedUSDC + 1) * 20);
    var score = Math.round(
      breakdown.ownedCertificates * 10 +
      breakdown.lifetimePurchases * 5 +
      breakdown.coursesRegistered * 8 +
      earnings
    );
    return { score: score, breakdown: breakdown };
  },

  getContractStatus: function() {
    return {
      certNFT: this.CERT_NFT_ADDRESS ? { deployed: true, address: this.CERT_NFT_ADDRESS } : { deployed: false },
      revenueSplitter: this.REVENUE_SPLITTER_ADDRESS ? { deployed: true, address: this.REVENUE_SPLITTER_ADDRESS } : { deployed: false },
      courseNFT: this.COURSE_NFT_ADDRESS ? { deployed: true, address: this.COURSE_NFT_ADDRESS } : { deployed: false },
      usdc: { deployed: true, address: this.USDC_ADDRESS }
    };
  }
};
