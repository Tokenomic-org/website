var TokenomicWallet = {
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDC_ABI: [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address owner) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)'
  ],
  PAYMENT_SPLITTER: null,
  BASE_CHAIN_ID: '0x2105',
  _listenersBound: false,
  _modalInjected: false,

  isMobile() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
  },

  getSiteUrl() {
    return window.location.host || 'tokenomic.org';
  },

  async connect() {
    this.showModal();
    return null;
  },

  async connectWithProvider(providerType) {
    this.hideModal();
    var ethereum = null;
    var mobile = this.isMobile();
    var siteUrl = this.getSiteUrl();
    var currentPath = window.location.pathname + window.location.search;

    if (providerType === 'metamask') {
      if (window.ethereum && window.ethereum.isMetaMask) {
        ethereum = window.ethereum;
      } else if (window.ethereum && window.ethereum.providers) {
        ethereum = window.ethereum.providers.find(function(p) { return p.isMetaMask; });
      }
      if (!ethereum) {
        if (mobile) {
          window.location.href = 'https://metamask.app.link/dapp/' + siteUrl + currentPath;
          return null;
        }
        window.open('https://metamask.io/download/', '_blank');
        return null;
      }
    } else if (providerType === 'rabby') {
      if (window.ethereum && window.ethereum.isRabby) {
        ethereum = window.ethereum;
      } else if (window.ethereum && window.ethereum.providers) {
        ethereum = window.ethereum.providers.find(function(p) { return p.isRabby; });
      }
      if (!ethereum) {
        if (mobile) {
          if (window.ethereum) {
            ethereum = window.ethereum;
          } else {
            window.open('https://rabby.io/', '_blank');
            return null;
          }
        } else {
          window.open('https://rabby.io/', '_blank');
          return null;
        }
      }
    } else if (providerType === 'coinbase') {
      if (window.ethereum && window.ethereum.isCoinbaseWallet) {
        ethereum = window.ethereum;
      } else if (window.ethereum && window.ethereum.providers) {
        ethereum = window.ethereum.providers.find(function(p) { return p.isCoinbaseWallet; });
      }
      if (!ethereum) {
        if (mobile) {
          window.location.href = 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent('https://' + siteUrl + currentPath);
          return null;
        }
        window.open('https://www.coinbase.com/wallet', '_blank');
        return null;
      }
    } else if (providerType === 'any') {
      if (window.ethereum) {
        ethereum = window.ethereum;
      }
    } else if (providerType === 'walletconnect' || providerType === 'coinbase-smart') {
      // Route through @wagmi/core (loaded by web3-bundle.js). Falls back to
      // an injected provider if wagmi has not finished bootstrapping yet.
      return await this.connectWithWagmi(providerType);
    }

    if (!ethereum && window.ethereum) {
      ethereum = window.ethereum;
    }

    if (!ethereum) {
      if (mobile) {
        window.location.href = 'https://metamask.app.link/dapp/' + siteUrl + currentPath;
      } else {
        alert('No wallet detected. Please install MetaMask, Coinbase Wallet, or Rabby.');
      }
      return null;
    }

    try {
      var accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      this.account = accounts[0];
      this._activeProvider = ethereum;
      this.chainId = await ethereum.request({ method: 'eth_chainId' });

      if (this.chainId !== this.BASE_CHAIN_ID) {
        await this.switchToBase(ethereum);
      }

      sessionStorage.setItem('tkn_wallet', this.account);
      this.updateUI();
      this.setupListeners(ethereum);
      return this.account;
    } catch (error) {
      console.error('Wallet connection failed:', error);
      return null;
    }
  },

  /**
   * Phase 0: connect through @wagmi/core for the QR / passkey flows that
   * cannot be done with raw window.ethereum.
   *
   *   walletconnect    -> WalletConnect v2 QR (requires WC_PROJECT_ID at build)
   *   coinbase-smart   -> Coinbase Smart Wallet (passkey-based, no extension)
   */
  async connectWithWagmi(kind) {
    var W = window.TokenomicWeb3;
    if (!W) {
      alert('Web3 stack still loading. Please wait a moment and try again.');
      return null;
    }
    var connector;
    try {
      var instances = (W.config && W.config.connectors) || [];
      if (kind === 'walletconnect') {
        connector = instances.find(function (c) { return c.id === 'walletConnect'; });
        if (!connector) {
          alert('WalletConnect is not configured. Set WC_PROJECT_ID and rebuild the web3 bundle.');
          return null;
        }
      } else if (kind === 'coinbase-smart') {
        connector = instances.find(function (c) { return c.id === 'coinbaseWalletSDK' || c.id === 'coinbaseWallet'; });
      }
      if (!connector) {
        alert('Connector not available.');
        return null;
      }
      var result = await W.connect({ connector: connector, chainId: W.chains.base.id });
      var addr = (result && result.accounts && result.accounts[0]) || null;
      if (!addr) return null;
      this.account = addr;
      this.chainId = '0x' + (result.chainId || 8453).toString(16);
      sessionStorage.setItem('tkn_wallet', this.account);
      this.updateUI();
      // Mirror account changes from wagmi back into the legacy session.
      try {
        if (!this._wagmiWatcher) {
          this._wagmiWatcher = W.watchAccount(function (acct) {
            if (acct && acct.address) {
              TokenomicWallet.account = acct.address;
              sessionStorage.setItem('tkn_wallet', acct.address);
            } else {
              TokenomicWallet.account = null;
              sessionStorage.removeItem('tkn_wallet');
            }
            TokenomicWallet.updateUI();
          });
        }
      } catch (_) { /* noop */ }
      return this.account;
    } catch (err) {
      console.error('wagmi connect failed:', err);
      return null;
    }
  },

  disconnect() {
    this.account = null;
    sessionStorage.removeItem('tkn_wallet');
    // Also disconnect the wagmi side if present so the next connect prompts
    // for a fresh provider rather than silently restoring the old session.
    try {
      if (window.TokenomicWeb3 && window.TokenomicWeb3.disconnect) {
        window.TokenomicWeb3.disconnect().catch(function () {});
      }
    } catch (_) { /* noop */ }
    this.updateUI();
  },

  async switchToBase(ethereum) {
    var eth = ethereum || window.ethereum;
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.BASE_CHAIN_ID }]
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: this.BASE_CHAIN_ID,
            chainName: 'Base',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org']
          }]
        });
      }
    }
  },

  setupListeners(ethereum) {
    if (this._listenersBound) return;
    this._listenersBound = true;
    var eth = ethereum || window.ethereum;
    if (eth) {
      eth.on('accountsChanged', (accounts) => {
        this.account = accounts[0] || null;
        if (this.account) {
          sessionStorage.setItem('tkn_wallet', this.account);
        } else {
          sessionStorage.removeItem('tkn_wallet');
        }
        this.updateUI();
      });
      eth.on('chainChanged', (chainId) => {
        this.chainId = chainId;
        this.updateUI();
      });
    }
  },

  async getUSDCBalance() {
    if (!this.account || typeof ethers === 'undefined') return '0.00';
    try {
      var eth = this._activeProvider || window.ethereum;
      const provider = new ethers.providers.Web3Provider(eth);
      const usdc = new ethers.Contract(this.USDC_ADDRESS, this.USDC_ABI, provider);
      const balance = await usdc.balanceOf(this.account);
      return ethers.utils.formatUnits(balance, 6);
    } catch (e) {
      console.error('Balance fetch error:', e);
      return '0.00';
    }
  },

  async payWithUSDC(recipientAddress, amountUSDC, description) {
    if (!this.account) {
      await this.connect();
      if (!this.account) return null;
    }
    try {
      var eth = this._activeProvider || window.ethereum;
      const provider = new ethers.providers.Web3Provider(eth);
      const signer = provider.getSigner();
      const usdc = new ethers.Contract(this.USDC_ADDRESS, this.USDC_ABI, signer);
      const amount = ethers.utils.parseUnits(amountUSDC.toString(), 6);
      const tx = await usdc.transfer(recipientAddress, amount);
      const receipt = await tx.wait();
      if (typeof TokenomicSupabase !== 'undefined') {
        await TokenomicSupabase.recordTransaction(receipt.transactionHash, amountUSDC, this.account, recipientAddress, description);
      }
      return receipt;
    } catch (error) {
      console.error('Payment failed:', error);
      return null;
    }
  },

  async connectWallet() { return await this.connect(); },
  getAddress() { return this.account || sessionStorage.getItem('tkn_wallet') || null; },
  async getBalance() { return await this.getUSDCBalance(); },

  truncateAddress(address) {
    if (!address) return '';
    return address.slice(0, 6) + '...' + address.slice(-4);
  },

  isLoggedIn() {
    return !!this.account;
  },

  updateUI() {
    var isConnected = !!this.account;

    document.querySelectorAll('.wallet-status-text').forEach(function(el) {
      el.textContent = isConnected ? TokenomicWallet.truncateAddress(TokenomicWallet.account) : 'Not Connected';
    });

    document.querySelectorAll('.wallet-connect-btn').forEach(function(el) {
      el.style.display = isConnected ? 'none' : 'inline-flex';
    });

    document.querySelectorAll('.wallet-disconnect-btn').forEach(function(el) {
      el.style.display = isConnected ? 'inline-flex' : 'none';
    });

    document.querySelectorAll('.wallet-login-btn').forEach(function(el) {
      el.style.display = isConnected ? 'none' : '';
    });

    document.querySelectorAll('.wallet-logged-in-btn').forEach(function(el) {
      el.style.display = isConnected ? '' : 'none';
    });

    document.querySelectorAll('.wallet-addr-text').forEach(function(el) {
      if (isConnected) {
        el.textContent = TokenomicWallet.truncateAddress(TokenomicWallet.account);
      }
    });

    document.querySelectorAll('.tkn-wallet-status').forEach(function(el) {
      if (isConnected) {
        el.classList.remove('disconnected');
      } else {
        el.classList.add('disconnected');
      }
    });

    if (!isConnected && TokenomicWallet.isDashboardPage()) {
      TokenomicWallet.showGate();
    } else {
      TokenomicWallet.hideGate();
    }
  },

  isDashboardPage() {
    var path = window.location.pathname;
    return path.indexOf('/dashboard') === 0;
  },

  showGate() {
    var gate = document.getElementById('tkn-login-gate');
    var content = document.querySelector('.dashboard-content');
    var sidebar = document.querySelector('.dashboard-sidebar');
    var sidebarCol = sidebar ? sidebar.closest('.col-lg-3') : null;
    var contentCol = gate ? gate.closest('.col-lg-9') : null;
    if (gate) gate.style.display = 'flex';
    if (content) content.style.display = 'none';
    if (sidebar) sidebar.style.display = 'none';
    if (sidebarCol) sidebarCol.style.display = 'none';
    if (contentCol) { contentCol.className = 'col-12'; }
  },

  hideGate() {
    var gate = document.getElementById('tkn-login-gate');
    var content = document.querySelector('.dashboard-content');
    var sidebar = document.querySelector('.dashboard-sidebar');
    var sidebarCol = sidebar ? sidebar.closest('.col-lg-3') : null;
    var contentCol = content ? content.closest('.col-lg-9, .col-12') : null;
    if (gate) gate.style.display = 'none';
    if (content) content.style.display = '';
    if (sidebar) sidebar.style.display = '';
    if (sidebarCol) sidebarCol.style.display = '';
    if (contentCol) { contentCol.className = 'col-lg-9 col-md-8 col-sm-12'; }
  },

  _injectModal() {
    if (this._modalInjected) return;
    this._modalInjected = true;

    var existing = document.getElementById('wallet-modal');
    if (existing) existing.remove();

    var mobile = this.isMobile();
    var mmLabel = mobile ? 'MetaMask' : 'MetaMask';
    var rbLabel = mobile ? 'Rabby Wallet' : 'Rabby Wallet';
    var cbLabel = mobile ? 'Coinbase Wallet' : 'Coinbase Wallet';
    var mmNote = mobile ? '<span class="wm-note">Opens MetaMask app</span>' : '';
    var cbNote = mobile ? '<span class="wm-note">Opens Coinbase app</span>' : '';

    var overlay = document.createElement('div');
    overlay.id = 'wallet-modal';
    overlay.innerHTML =
      '<div class="wm-backdrop" onclick="TokenomicWallet.hideModal()"></div>' +
      '<div class="wm-box">' +
        '<button class="wm-close" onclick="TokenomicWallet.hideModal()">&times;</button>' +
        '<div class="wm-logo"><img src="/assets/images/logo.png" alt="Tokenomic"></div>' +
        '<h2 class="wm-title">Connect Wallet</h2>' +
        '<p class="wm-subtitle">Choose your preferred wallet to continue</p>' +
        '<div class="wm-wallets">' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'metamask\')">' +
            '<div class="wm-icon"><img src="/assets/images/wallets/metamask.png" alt="MetaMask" style="width:100%;height:100%;object-fit:contain;"/></div>' +
            '<div class="wm-info"><span class="wm-name">' + mmLabel + '</span>' + mmNote + '</div>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'coinbase\')">' +
            '<div class="wm-icon"><img src="/assets/images/wallets/coinbase.png" alt="Coinbase" style="width:100%;height:100%;object-fit:contain;"/></div>' +
            '<div class="wm-info"><span class="wm-name">' + cbLabel + '</span>' + cbNote + '</div>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'rabby\')">' +
            '<div class="wm-icon"><img src="/assets/images/wallets/rabby.png" alt="Rabby" style="width:100%;height:100%;object-fit:contain;"/></div>' +
            '<div class="wm-info"><span class="wm-name">' + rbLabel + '</span></div>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'walletconnect\')">' +
            '<div class="wm-icon" style="background:#3B99FC;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">WC</div>' +
            '<div class="wm-info"><span class="wm-name">WalletConnect</span><span class="wm-note">Scan QR with any wallet</span></div>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'coinbase-smart\')">' +
            '<div class="wm-icon" style="background:#0052FF;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">CB</div>' +
            '<div class="wm-info"><span class="wm-name">Coinbase Smart Wallet</span><span class="wm-note">Passkey — no extension needed</span></div>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
        '</div>' +
        (window.ethereum ? '<div class="wm-divider"><span>or</span></div>' +
          '<button class="wm-detect-btn" onclick="TokenomicWallet.connectWithProvider(\'any\')">Use Detected Wallet</button>' : '') +
        (mobile ? '<p class="wm-mobile-hint">On mobile? Tap a wallet to open its app. If you don\'t have one installed, it will take you to the app store.</p>' : '') +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#wallet-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;align-items:center;justify-content:center;}' +
      '#wallet-modal .wm-backdrop{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);}' +
      '#wallet-modal .wm-box{position:relative;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px 36px 36px;max-width:420px;width:90%;margin:auto;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.5);animation:wmFadeIn 0.25s ease;max-height:90vh;overflow-y:auto;}' +
      '@keyframes wmFadeIn{from{opacity:0;transform:scale(0.95) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}' +
      '#wallet-modal .wm-close{position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.08);border:none;color:#9ca3af;font-size:22px;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;line-height:1;}' +
      '#wallet-modal .wm-close:hover{background:rgba(255,255,255,0.15);color:#fff;}' +
      '#wallet-modal .wm-logo{margin-bottom:20px;}' +
      '#wallet-modal .wm-logo img{height:48px;width:auto;}' +
      '#wallet-modal .wm-title{color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;font-family:"Poppins",sans-serif;}' +
      '#wallet-modal .wm-subtitle{color:#9ca3af;font-size:14px;margin:0 0 28px;line-height:1.5;}' +
      '#wallet-modal .wm-wallets{display:flex;flex-direction:column;gap:10px;}' +
      '#wallet-modal .wm-wallet-btn{display:flex;align-items:center;gap:14px;width:100%;padding:14px 18px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:14px;cursor:pointer;transition:all 0.2s;color:#fff;font-size:16px;font-weight:500;text-align:left;}' +
      '#wallet-modal .wm-wallet-btn:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.15);transform:translateY(-1px);}' +
      '#wallet-modal .wm-icon{width:40px;height:40px;flex-shrink:0;border-radius:10px;overflow:hidden;}' +
      '#wallet-modal .wm-icon svg{width:100%;height:100%;display:block;}' +
      '#wallet-modal .wm-info{flex:1;display:flex;flex-direction:column;align-items:flex-start;}' +
      '#wallet-modal .wm-name{display:block;}' +
      '#wallet-modal .wm-note{display:block;font-size:12px;color:#9ca3af;font-weight:400;margin-top:2px;}' +
      '#wallet-modal .wm-wallet-btn .wm-arrow{width:20px;height:20px;color:#6b7280;flex-shrink:0;transition:color 0.2s;}' +
      '#wallet-modal .wm-wallet-btn:hover .wm-arrow{color:#fff;}' +
      '#wallet-modal .wm-divider{display:flex;align-items:center;gap:12px;margin:16px 0;color:#6b7280;font-size:13px;}' +
      '#wallet-modal .wm-divider::before,#wallet-modal .wm-divider::after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.1);}' +
      '#wallet-modal .wm-detect-btn{width:100%;padding:12px;background:rgba(249,115,22,0.15);border:1px solid rgba(249,115,22,0.3);border-radius:12px;color:#f97316;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s;}' +
      '#wallet-modal .wm-detect-btn:hover{background:rgba(249,115,22,0.25);}' +
      '#wallet-modal .wm-mobile-hint{color:#6b7280;font-size:12px;margin:16px 0 0;line-height:1.5;}';

    document.head.appendChild(style);
    document.body.appendChild(overlay);
  },

  showModal() {
    this._injectModal();
    var modal = document.getElementById('wallet-modal');
    if (modal) modal.style.display = 'flex';
  },

  hideModal() {
    var modal = document.getElementById('wallet-modal');
    if (modal) modal.style.display = 'none';
  }
};

document.addEventListener('DOMContentLoaded', function() {
  var oldModal = document.getElementById('wallet-modal');
  if (oldModal && !TokenomicWallet._modalInjected) {
    oldModal.remove();
  }

  var saved = sessionStorage.getItem('tkn_wallet');
  if (saved && window.ethereum) {
    window.ethereum.request({ method: 'eth_accounts' }).then(function(accounts) {
      if (accounts.length > 0) {
        TokenomicWallet.account = accounts[0];
        sessionStorage.setItem('tkn_wallet', accounts[0]);
      } else {
        sessionStorage.removeItem('tkn_wallet');
      }
      TokenomicWallet.updateUI();
      TokenomicWallet.setupListeners();
    }).catch(function() {
      TokenomicWallet.updateUI();
    });
  } else if (window.ethereum && window.ethereum.selectedAddress) {
    TokenomicWallet.account = window.ethereum.selectedAddress;
    sessionStorage.setItem('tkn_wallet', window.ethereum.selectedAddress);
    TokenomicWallet.updateUI();
    TokenomicWallet.setupListeners();
  } else {
    TokenomicWallet.updateUI();
  }
});

if (typeof window !== "undefined") { window.TokenomicWallet = TokenomicWallet; }
