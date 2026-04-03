const TokenomicWallet = {
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

  async connect() {
    this.showModal();
    return null;
  },

  async connectWithProvider(providerType) {
    this.hideModal();
    var ethereum = null;

    if (providerType === 'metamask') {
      if (window.ethereum && window.ethereum.isMetaMask) {
        ethereum = window.ethereum;
      } else if (window.ethereum && window.ethereum.providers) {
        ethereum = window.ethereum.providers.find(function(p) { return p.isMetaMask; });
      }
      if (!ethereum) {
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
        window.open('https://rabby.io/', '_blank');
        return null;
      }
    } else if (providerType === 'coinbase') {
      if (window.ethereum && window.ethereum.isCoinbaseWallet) {
        ethereum = window.ethereum;
      } else if (window.ethereum && window.ethereum.providers) {
        ethereum = window.ethereum.providers.find(function(p) { return p.isCoinbaseWallet; });
      }
      if (!ethereum) {
        window.open('https://www.coinbase.com/wallet', '_blank');
        return null;
      }
    }

    if (!ethereum && window.ethereum) {
      ethereum = window.ethereum;
    }

    if (!ethereum) {
      alert('No wallet detected. Please install a Web3 wallet.');
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

  disconnect() {
    this.account = null;
    sessionStorage.removeItem('tkn_wallet');
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
            '<div class="wm-icon wm-icon-mm"><svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="10" fill="#F6851B"/><path d="M30.7 10l-8.2 6.1 1.5-3.6L30.7 10z" fill="#E2761B" stroke="#E2761B" stroke-width=".2"/><path d="M9.3 10l8.1 6.2-1.4-3.7L9.3 10zm18 17.8l-2.2 3.3 4.6 1.3 1.3-4.5-3.7-.1zm-22 .1l1.3 4.5 4.6-1.3-2.2-3.3-3.7.1z" fill="#E4761B" stroke="#E4761B" stroke-width=".2"/><path d="M15 19.5l-1.3 2 4.5.2-.2-5-3 2.8zm10 0l-3.1-2.9-.1 5.1 4.5-.2-1.3-2z" fill="#E4761B" stroke="#E4761B" stroke-width=".2"/><path d="M15.7 31.1l2.7-1.3-2.3-1.8-.4 3.1zm5.9-1.3l2.7 1.3-.4-3.1-2.3 1.8z" fill="#E4761B" stroke="#E4761B" stroke-width=".2"/><path d="M24.3 31.1l-2.7-1.3.2 1.7v.7l2.5-1.1zm-8.6 0l2.5 1.1v-.7l.2-1.7-2.7 1.3z" fill="#D7C1B3" stroke="#D7C1B3" stroke-width=".2"/><path d="M18.3 25.4l-2.2-.7 1.6-.7.6 1.4zm3.4 0l.6-1.4 1.6.7-2.2.7z" fill="#233447" stroke="#233447" stroke-width=".2"/><path d="M15.7 31.1l.4-3.3-2.6.1 2.2 3.2zm8.2-3.3l.4 3.3 2.2-3.2-2.6-.1zm2-6.3l-4.5.2.4 2.3.6-1.4 1.6.7 1.9-1.8zm-11.8 1.8l1.6-.7.6 1.4.4-2.3-4.5-.2 1.9 1.8z" fill="#CD6116" stroke="#CD6116" stroke-width=".2"/><path d="M13.7 21.5l2 3.9-.1-1.9-1.9-2zm12.6 2l-.1 1.9 2-3.9-1.9 2zm-8.1-1.8l-.4 2.3.5 2.7.1-3.5-.2-1.5zm3.6 0l-.2 1.5.1 3.5.5-2.7-.4-2.3z" fill="#E4751F" stroke="#E4751F" stroke-width=".2"/><path d="M26.5 21.5l-1.9 2 .1 1.9 2-3.9zm-12.8 0l-2 3.9.1-1.9 1.9-2z" fill="#F6851B" stroke="#F6851B" stroke-width=".2"/></svg></div>' +
            '<span>MetaMask</span>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'rabby\')">' +
            '<div class="wm-icon wm-icon-rabby"><svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="10" fill="#7C71DF"/><ellipse cx="20" cy="18" rx="9" ry="8" fill="#fff" opacity=".9"/><ellipse cx="17" cy="16" rx="2" ry="2.5" fill="#7C71DF"/><ellipse cx="23" cy="16" rx="2" ry="2.5" fill="#7C71DF"/><path d="M14 22c0 0 2 4 6 4s6-4 6-4" stroke="#7C71DF" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="14" r="3" fill="#fff" opacity=".7"/><circle cx="28" cy="14" r="3" fill="#fff" opacity=".7"/></svg></div>' +
            '<span>Rabby Wallet</span>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
          '<button class="wm-wallet-btn" onclick="TokenomicWallet.connectWithProvider(\'coinbase\')">' +
            '<div class="wm-icon wm-icon-cb"><svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="10" fill="#1652F0"/><circle cx="20" cy="20" r="12" fill="#1652F0"/><circle cx="20" cy="20" r="10" fill="#fff"/><rect x="15" y="17" width="4" height="6" rx="1" fill="#1652F0"/><rect x="21" y="17" width="4" height="6" rx="1" fill="#1652F0"/></svg></div>' +
            '<span>Coinbase Wallet</span>' +
            '<svg class="wm-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#wallet-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;align-items:center;justify-content:center;}' +
      '#wallet-modal .wm-backdrop{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);}' +
      '#wallet-modal .wm-box{position:relative;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px 36px 36px;max-width:420px;width:90%;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.5);animation:wmFadeIn 0.25s ease;}' +
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
      '#wallet-modal .wm-wallet-btn img{width:40px;height:40px;border-radius:10px;object-fit:contain;flex-shrink:0;}' +
      '#wallet-modal .wm-icon{width:40px;height:40px;flex-shrink:0;border-radius:10px;overflow:hidden;}' +
      '#wallet-modal .wm-icon svg{width:100%;height:100%;display:block;}' +
      '#wallet-modal .wm-wallet-btn span{flex:1;}' +
      '#wallet-modal .wm-wallet-btn .wm-arrow{width:20px;height:20px;color:#6b7280;flex-shrink:0;transition:color 0.2s;}' +
      '#wallet-modal .wm-wallet-btn:hover .wm-arrow{color:#fff;}';

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
