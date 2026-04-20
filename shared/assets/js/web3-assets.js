var TokenomicAssets = {
  BASE_CHAIN_ID: 8453,
  BASE_CHAIN_HEX: '0x2105',
  BASE_RPC: 'https://mainnet.base.org',
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

  CERT_NFT_ADDRESS: null,
  REVENUE_SPLITTER_ADDRESS: null,
  COURSE_NFT_ADDRESS: null,

  CERT_NFT_ABI: [
    'function safeMint(address to, string memory tokenURI) public returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)'
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
    'function approve(address spender, uint256 amount) returns (bool)'
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

    var recipient = opts.recipient || this.REVENUE_SPLITTER_ADDRESS;
    if (!recipient) {
      throw new Error('No payment recipient configured. Set REVENUE_SPLITTER_ADDRESS or pass opts.recipient.');
    }

    if (typeof ethers === 'undefined') throw new Error('ethers library not loaded');

    var eth = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet._activeProvider) || window.ethereum;
    var provider = new ethers.providers.Web3Provider(eth);
    var signer = provider.getSigner();
    var usdc = new ethers.Contract(this.USDC_ADDRESS, this.USDC_ABI, signer);
    var amount = ethers.utils.parseUnits(priceNum.toFixed(6), 6);

    var tx = await usdc.transfer(recipient, amount);
    var receipt = await tx.wait();

    var asset = await this.registerAsset({
      type: 'course',
      title: opts.title || ('Course #' + courseId),
      description: 'Purchased for ' + priceInUSDC + ' USDC',
      tx_hash: receipt.transactionHash,
      contract_address: this.USDC_ADDRESS,
      status: 'purchased'
    });
    asset.course_id = courseId;

    return {
      success: true,
      asset: asset,
      txHash: receipt.transactionHash,
      explorerUrl: 'https://basescan.org/tx/' + receipt.transactionHash
    };
  },

  async claimCertificate(courseId, opts) {
    opts = opts || {};
    var wallet = this.getWallet();
    if (!wallet) {
      if (typeof TokenomicWallet !== 'undefined') await TokenomicWallet.connect();
      wallet = this.getWallet();
      if (!wallet) throw new Error('Wallet not connected');
    }
    var result = await this.mintCertification({
      courseTitle: opts.title || ('Course #' + courseId),
      metadata_uri: opts.metadata_uri || ('ipfs://cert/' + courseId)
    });
    if (result && result.asset) {
      result.asset.course_id = courseId;
    }
    return result;
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
