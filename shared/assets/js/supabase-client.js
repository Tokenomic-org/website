const TokenomicSupabase = {
  client: null,

  init() {
    const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

    if (SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')) {
      console.warn('Supabase not configured. Using demo data.');
      this.client = null;
    } else if (typeof supabase !== 'undefined') {
      this.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      console.warn('Supabase SDK not loaded. Dashboard features will use demo data.');
    }
  },

  async getProfile(walletAddress) {
    if (!this.client) return this.demoData('profile');
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();
    return error ? null : data;
  },

  async upsertProfile(profileData) {
    if (!this.client) return profileData;
    const { data, error } = await this.client
      .from('profiles')
      .upsert(profileData)
      .select()
      .single();
    return error ? null : data;
  },

  async getCommunities(educatorWallet) {
    if (!this.client) return this.demoData('communities');
    const query = educatorWallet
      ? this.client.from('communities').select('*').eq('educator_wallet', educatorWallet)
      : this.client.from('communities').select('*');
    const { data, error } = await query;
    return error ? [] : data;
  },

  async createCommunity(communityData) {
    if (!this.client) return communityData;
    const { data, error } = await this.client
      .from('communities')
      .insert(communityData)
      .select()
      .single();
    return error ? null : data;
  },

  async getCourses(communityId) {
    if (!this.client) return this.demoData('courses');
    const query = communityId
      ? this.client.from('courses').select('*').eq('community_id', communityId)
      : this.client.from('courses').select('*');
    const { data, error } = await query;
    return error ? [] : data;
  },

  async getEnrollments(courseId) {
    if (!this.client) return this.demoData('enrollments');
    const { data, error } = await this.client
      .from('enrollments')
      .select('*, profiles(*)')
      .eq('course_id', courseId);
    return error ? [] : data;
  },

  async getBookings(consultantWallet) {
    if (!this.client) return this.demoData('bookings');
    const { data, error } = await this.client
      .from('bookings')
      .select('*')
      .eq('consultant_wallet', consultantWallet)
      .order('booking_date', { ascending: true });
    return error ? [] : data;
  },

  async createBooking(bookingData) {
    if (!this.client) return bookingData;
    const { data, error } = await this.client
      .from('bookings')
      .insert(bookingData)
      .select()
      .single();
    return error ? null : data;
  },

  async getRevenue(walletAddress) {
    if (!this.client) return this.demoData('revenue');
    const { data, error } = await this.client
      .from('revenue_tx')
      .select('*')
      .eq('recipient_wallet', walletAddress)
      .order('created_at', { ascending: false });
    return error ? [] : data;
  },

  async recordTransaction(txHash, amountUsdc, senderWallet, recipientWallet, description) {
    if (!this.client) return null;
    const { data, error } = await this.client
      .from('revenue_tx')
      .insert({
        tx_hash: txHash,
        amount_usdc: amountUsdc,
        sender_wallet: senderWallet,
        recipient_wallet: recipientWallet,
        description: description,
        status: 'confirmed'
      })
      .select()
      .single();
    return error ? null : data;
  },

  async getMessages(communityId) {
    if (!this.client) return this.demoData('messages');
    const { data, error } = await this.client
      .from('messages')
      .select('*, profiles(display_name, avatar_url)')
      .eq('community_id', communityId)
      .order('created_at', { ascending: true })
      .limit(100);
    return error ? [] : data;
  },

  async sendMessage(messageData) {
    if (!this.client) return messageData;
    const { data, error } = await this.client
      .from('messages')
      .insert(messageData)
      .select()
      .single();
    return error ? null : data;
  },

  async getEducators() {
    if (!this.client) return this.demoData('educators');
    const { data, error } = await this.client
      .from('profiles')
      .select('*, communities(id, name, members_count)')
      .eq('role', 'educator')
      .eq('approved', true)
      .order('xp', { ascending: false });
    return error ? [] : data;
  },

  async getConsultants() {
    if (!this.client) return this.demoData('consultants');
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('role', 'consultant')
      .eq('approved', true)
      .order('xp', { ascending: false });
    return error ? [] : data;
  },

  async getArticles(category) {
    if (!this.client) return this.demoData('articles');
    let query = this.client
      .from('articles')
      .select('*, profiles(display_name, avatar_url, wallet_address)')
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    return error ? [] : data;
  },

  async getAuthors() {
    if (!this.client) return this.demoData('authors');
    const { data, error } = await this.client
      .from('profiles')
      .select('display_name, avatar_url, wallet_address, role, specialty, bio')
      .in('role', ['educator', 'consultant'])
      .eq('approved', true)
      .order('xp', { ascending: false })
      .limit(6);
    return error ? [] : data;
  },

  subscribeToMessages(communityId, callback) {
    if (!this.client) return null;
    return this.client
      .channel(`messages:${communityId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `community_id=eq.${communityId}`
      }, payload => callback(payload.new))
      .subscribe();
  },

  demoData(type) {
    const demos = {
      profile: { id: 1, display_name: 'Demo User', role: 'educator', wallet_address: '0x1234...abcd' },
      communities: [
        { id: 1, name: 'DeFi Fundamentals', description: 'Learn the basics of decentralized finance', members_count: 234, access_price_usdc: 25, educator_wallet: '0x1234...abcd', created_at: '2025-01-15' },
        { id: 2, name: 'Advanced Tokenomics', description: 'Deep dive into token design and economics', members_count: 89, access_price_usdc: 50, educator_wallet: '0x1234...abcd', created_at: '2025-03-01' },
        { id: 3, name: 'Yield Strategies', description: 'Master yield farming and liquidity provision', members_count: 156, access_price_usdc: 35, educator_wallet: '0x1234...abcd', created_at: '2025-02-10' }
      ],
      courses: [
        { id: 1, title: 'Introduction to DeFi', description: 'A comprehensive intro course', modules_count: 12, enrolled_count: 180, price_usdc: 15, status: 'active', community_id: 1 },
        { id: 2, title: 'Tokenomics Design', description: 'Learn to design token economies', modules_count: 8, enrolled_count: 67, price_usdc: 30, status: 'active', community_id: 2 },
        { id: 3, title: 'Smart Contract Security', description: 'Security auditing for DeFi', modules_count: 10, enrolled_count: 45, price_usdc: 40, status: 'draft', community_id: 1 }
      ],
      enrollments: [
        { id: 1, student_wallet: '0xaaaa...1111', progress: 85, enrolled_at: '2025-01-20', profiles: { display_name: 'Alice' } },
        { id: 2, student_wallet: '0xbbbb...2222', progress: 42, enrolled_at: '2025-02-05', profiles: { display_name: 'Bob' } }
      ],
      bookings: [
        { id: 1, client_name: 'Acme DAO', booking_date: '2026-04-10', time_slot: '10:00 AM', duration: 60, price_usdc: 200, status: 'confirmed', topic: 'Tokenomics Review' },
        { id: 2, client_name: 'DeFi Labs', booking_date: '2026-04-12', time_slot: '2:00 PM', duration: 90, price_usdc: 300, status: 'pending', topic: 'Smart Contract Audit' },
        { id: 3, client_name: 'Chain Ventures', booking_date: '2026-04-15', time_slot: '11:00 AM', duration: 60, price_usdc: 200, status: 'confirmed', topic: 'DeFi Strategy' }
      ],
      revenue: [
        { id: 1, tx_hash: '0xabc123...', amount_usdc: 200, sender_wallet: '0xaaaa...1111', description: 'Course enrollment', status: 'confirmed', created_at: '2026-03-15T10:30:00Z' },
        { id: 2, tx_hash: '0xdef456...', amount_usdc: 300, sender_wallet: '0xbbbb...2222', description: 'Consultation booking', status: 'confirmed', created_at: '2026-03-18T14:00:00Z' },
        { id: 3, tx_hash: '0xghi789...', amount_usdc: 50, sender_wallet: '0xcccc...3333', description: 'Community access', status: 'confirmed', created_at: '2026-03-20T09:15:00Z' },
        { id: 4, tx_hash: '0xjkl012...', amount_usdc: 150, sender_wallet: '0xdddd...4444', description: 'Workshop fee', status: 'confirmed', created_at: '2026-03-22T16:45:00Z' },
        { id: 5, tx_hash: '0xmno345...', amount_usdc: 25, sender_wallet: '0xeeee...5555', description: 'Community access', status: 'confirmed', created_at: '2026-03-25T11:00:00Z' }
      ],
      educators: [
        { id: 1, display_name: 'Dr. Sarah Chen', wallet_address: '0x742d...bD1e', role: 'educator', bio: 'PhD in Economics from MIT. Advised 20+ DeFi protocols on tokenomics design.', specialty: 'Tokenomics & Economic Design', xp: 4200, approved: true, avatar_url: null, communities: [{ id: 1, name: 'DeFi Fundamentals', members_count: 234 }] },
        { id: 2, display_name: 'Marcus Webb', wallet_address: '0x8Ba1...BA72', role: 'educator', bio: 'Former Trail of Bits auditor. 8+ years in blockchain security and smart contract analysis.', specialty: 'Smart Contract Security', xp: 3800, approved: true, avatar_url: null, communities: [{ id: 2, name: 'Advanced Tokenomics', members_count: 89 }] },
        { id: 3, display_name: 'Aisha Patel', wallet_address: '0x2546...c30', role: 'educator', bio: 'Ex-Aave contributor. Liquidity optimization and governance framework expert.', specialty: 'DeFi Protocol Strategy', xp: 3100, approved: true, avatar_url: null, communities: [{ id: 3, name: 'Yield Strategies', members_count: 156 }] },
        { id: 4, display_name: 'James Liu', wallet_address: '0xbDA5...97E', role: 'educator', bio: 'Blockchain attorney with expertise across US, EU, and APAC jurisdictions.', specialty: 'Regulatory & Compliance', xp: 2900, approved: true, avatar_url: null, communities: [] },
        { id: 5, display_name: 'Elena Rossi', wallet_address: '0xfC23...A41', role: 'educator', bio: 'Former BlackRock analyst. Bridges traditional finance with DeFi investment strategies.', specialty: 'Institutional DeFi', xp: 2700, approved: true, avatar_url: null, communities: [{ id: 4, name: 'Institutional Onboarding', members_count: 67 }] },
        { id: 6, display_name: 'David Okonkwo', wallet_address: '0x91Ae...C82', role: 'educator', bio: 'DAO governance researcher. Published 15+ papers on decentralized coordination mechanisms.', specialty: 'DAO Governance', xp: 2400, approved: true, avatar_url: null, communities: [] }
      ],
      consultants: [
        { id: 1, display_name: 'Dr. Sarah Chen', wallet_address: '0x742d...bD1e', role: 'consultant', bio: 'PhD in Economics. Advised 20+ DeFi protocols on tokenomics and mechanism design.', specialty: 'Tokenomics & Economic Design', rate_30: 75, rate_60: 150, sessions: 142, rating: 4.9, xp: 4200, approved: true, avatar_url: null },
        { id: 2, display_name: 'Marcus Webb', wallet_address: '0x8Ba1...BA72', role: 'consultant', bio: 'Former Trail of Bits auditor. Solidity security specialist and penetration tester.', specialty: 'Smart Contract Security', rate_30: 100, rate_60: 180, sessions: 98, rating: 4.8, xp: 3800, approved: true, avatar_url: null },
        { id: 3, display_name: 'Aisha Patel', wallet_address: '0x2546...c30', role: 'consultant', bio: 'Ex-Aave contributor. Liquidity and governance optimization expert.', specialty: 'DeFi Protocol Strategy', rate_30: 60, rate_60: 110, sessions: 76, rating: 4.7, xp: 3100, approved: true, avatar_url: null },
        { id: 4, display_name: 'James Liu', wallet_address: '0xbDA5...97E', role: 'consultant', bio: 'Blockchain attorney. Regulatory counsel for US, EU, and APAC jurisdictions.', specialty: 'Regulatory & Compliance', rate_30: 125, rate_60: 225, sessions: 53, rating: 4.9, xp: 2900, approved: true, avatar_url: null },
        { id: 5, display_name: 'Natalie Kim', wallet_address: '0xD4f2...E19', role: 'consultant', bio: 'Risk modeling specialist. Built risk frameworks for 10+ lending protocols.', specialty: 'Risk Management', rate_30: 90, rate_60: 160, sessions: 64, rating: 4.8, xp: 2600, approved: true, avatar_url: null }
      ],
      articles: [
        { id: 1, title: 'Understanding Iron Condor and Butterfly Spread', slug: 'iron-condor-butterfly-spread', category: 'Strategy', excerpt: 'A deep dive into advanced options strategies used in DeFi derivatives markets, comparing iron condors with butterfly spreads for risk management.', image_url: '/assets/images/learn/Butterfly.png', published_at: '2025-01-11', profiles: { display_name: 'Dr. Sarah Chen', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 2, title: 'Advanced Options Strategies in DeFi', slug: 'advanced-strategies-in-defi', category: 'Strategy', excerpt: 'Exploring how traditional options strategies are being adapted and improved upon in decentralized finance protocols.', image_url: '/assets/images/learn/defi.png', published_at: '2025-01-01', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 3, title: 'Arbitrage - A Practical Guide', slug: 'arbitrage-a-practical-guide', category: 'Strategy', excerpt: 'Learn how to identify and execute arbitrage opportunities across decentralized exchanges and lending protocols.', image_url: '/assets/images/learn/arbitrage.png', published_at: '2024-08-12', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 4, title: 'Case Studies - Successful Arbitrage in DEXs', slug: 'case-studies-successful-arbitrage', category: 'Strategy', excerpt: 'Real-world case studies of successful arbitrage strategies executed across decentralized exchanges.', image_url: '/assets/images/learn/case-studies-arbitrage.png', published_at: '2024-06-25', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 5, title: 'Smart Contract Security Best Practices', slug: 'smart-contract-security-best-practices', category: 'Technical', excerpt: 'Smart contracts are self-executing programs on blockchain networks. Their immutability enhances security but also amplifies the impact of any vulnerabilities.', image_url: '/assets/images/learn/cyber_security_crypto.png', published_at: '2024-12-12', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 6, title: 'The Role of Smart Contracts', slug: 'role-of-smart-contracts', category: 'Technical', excerpt: 'Smart contracts are the foundation of DeFi, enabling decentralized approaches by automating processes, ensuring transparency, and fostering trust.', image_url: '/assets/images/learn/smart-contracts.png', published_at: '2024-10-24', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 7, title: 'Building a Blockchain, A Comprehensive Guide', slug: 'fundamentals-building-blockchain', category: 'Technical', excerpt: 'Blockchain is a transformative technology impacting various sectors. This article explores the essential building blocks of creating a blockchain.', image_url: '/assets/images/learn/fundamentals-building-blockchain.png', published_at: '2023-07-19', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 8, title: 'Zero-Knowledge Proofs, A Pillar of Cryptographic Privacy', slug: 'zero-knowledge-proofs', category: 'Technical', excerpt: 'Discover the importance of zero-knowledge proofs (ZKPs) in cryptography. Learn how ZKPs ensure data privacy and security by allowing verification without revealing details.', image_url: '/assets/images/learn/zero-knowledge-proofs.png', published_at: '2023-03-11', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 9, title: 'Decentralized Data Storage, An Overview of Techniques and Algorithms', slug: 'decentralized-data-storage', category: 'Technical', excerpt: 'Decentralized data storage allows data storage and retrieval without a central authority, offering improved reliability, security, and scalability.', image_url: '/assets/images/learn/decentralized-data-storage.png', published_at: '2023-01-07', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 10, title: 'The Basics of DeFi', slug: 'the-basics-of-defi', category: 'Technical', excerpt: 'Decentralized Finance, or DeFi, is transforming the financial world by offering an open, transparent, and intermediary-free alternative to traditional financial systems.', image_url: '/assets/images/learn/defi-basics.png', published_at: '2023-01-01', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } },
        { id: 11, title: 'Analysis of DeFi\'s Impact on Traditional Financial Markets', slug: 'analysis-defi-impact-traditional-financial-markets', category: 'Market', excerpt: 'An in-depth analysis of how decentralized finance is reshaping and impacting traditional financial markets and institutions.', image_url: '/assets/images/learn/Analysis-of-DeFi.png', published_at: '2024-07-04', profiles: { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg' } }
      ],
      authors: [
        { display_name: 'Guillaume Lauzier', avatar_url: '/assets/images/learn/100.jpg', role: 'educator', specialty: 'DeFi & Technical Implementation', bio: 'Founder of and Institutional Educator at Tokenomic, specializing in technical implementation, financial analysis, and digital assets.' },
        { display_name: 'Irmak Yolcu', avatar_url: '/assets/images/learn/team-3.jpeg', role: 'educator', specialty: 'Web3 Strategy & Digital Assets', bio: 'Blockchain professional, academic, and ecosystem builder with a PhD in Business Administration, specializing in Web3 strategy and digital assets.' },
        { display_name: 'Michael Ruiz', avatar_url: '/assets/images/learn/team-2.jpeg', role: 'educator', specialty: 'Web3 Content & Community', bio: 'Blockchain content creator and event host covering Web3, crypto, and decentralized technologies.' }
      ],
      messages: [
        { id: 1, content: 'Welcome to the community!', community_id: 1, created_at: '2026-03-01T10:00:00Z', profiles: { display_name: 'Admin' } },
        { id: 2, content: 'Excited to learn about DeFi tokenomics!', community_id: 1, created_at: '2026-03-01T10:05:00Z', profiles: { display_name: 'Alice' } },
        { id: 3, content: 'Check out module 3 for the latest on yield farming.', community_id: 1, created_at: '2026-03-01T10:10:00Z', profiles: { display_name: 'Admin' } }
      ]
    };
    return demos[type] || [];
  }
};

document.addEventListener('DOMContentLoaded', function() {
  TokenomicSupabase.init();
});
