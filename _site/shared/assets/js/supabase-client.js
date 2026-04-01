const TokenomicSupabase = {
  client: null,

  init() {
    const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

    if (typeof supabase !== 'undefined') {
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
