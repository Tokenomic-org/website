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

  async connect() {
    if (typeof window.ethereum === 'undefined') {
      this.showModal();
      return null;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      this.account = accounts[0];
      this.chainId = await window.ethereum.request({ method: 'eth_chainId' });

      if (this.chainId !== this.BASE_CHAIN_ID) {
        await this.switchToBase();
      }

      sessionStorage.setItem('tkn_wallet', this.account);
      this.updateUI();
      this.setupListeners();
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

  async switchToBase() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.BASE_CHAIN_ID }]
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
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

  setupListeners() {
    if (this._listenersBound) return;
    this._listenersBound = true;
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        this.account = accounts[0] || null;
        if (this.account) {
          sessionStorage.setItem('tkn_wallet', this.account);
        } else {
          sessionStorage.removeItem('tkn_wallet');
        }
        this.updateUI();
      });
      window.ethereum.on('chainChanged', (chainId) => {
        this.chainId = chainId;
        this.updateUI();
      });
    }
  },

  async getUSDCBalance() {
    if (!this.account || typeof ethers === 'undefined') return '0.00';
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
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
      const provider = new ethers.providers.Web3Provider(window.ethereum);
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

  showModal() {
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
