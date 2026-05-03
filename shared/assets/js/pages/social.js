/* Extracted from dashboard/social.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function socialPage() {
    return {
        filter: 'all',
        posts:[
            {id:1,content:'Just launched our new DeFi Tokenomics course! Learn the fundamentals of token design and economic modeling. Enroll now at tokenomic.org/training',platforms:['facebook','twitter','linkedin'],scheduled_at:null,status:'published',analytics:{views:4820,likes:312,shares:87,comments:24,engagement:8.8}},
            {id:2,content:'New research: Analysis of DeFi\'s Impact on Traditional Financial Markets. Deep dive into cross-market dynamics and institutional adoption trends.',platforms:['twitter','linkedin','facebook'],scheduled_at:null,status:'published',analytics:{views:3150,likes:198,shares:63,comments:15,engagement:8.7}},
            {id:3,content:'Zero-Knowledge Proofs explained: A Pillar of Cryptographic Privacy. Our latest article breaks down ZKPs for institutional audiences.',platforms:['twitter','linkedin','youtube'],scheduled_at:null,status:'published',analytics:{views:2740,likes:156,shares:42,comments:11,engagement:7.6}},
            {id:4,content:'Live workshop this Friday: Smart Contract Security Best Practices. Join our experts for a hands-on session covering auditing, common vulnerabilities, and mitigation strategies.',platforms:['facebook','twitter','instagram','linkedin','tiktok'],scheduled_at:'2026-04-18 10:00',status:'scheduled',analytics:null},
            {id:5,content:'New article dropping next week: Yield Farming Strategies for 2026. We cover risk-adjusted returns, impermanent loss hedging, and multi-protocol stacking.',platforms:['twitter','linkedin','youtube','tiktok'],scheduled_at:'2026-04-20 14:00',status:'scheduled',analytics:null},
            {id:6,content:'Gas Optimization in Solidity: our latest technical guide is live. Learn how to reduce on-chain costs by 40-60% with proven patterns.',platforms:['twitter','linkedin'],scheduled_at:null,status:'published',analytics:{views:1890,likes:121,shares:38,comments:9,engagement:8.9}},
        ],
        showComposer:false,
        editingPostId:null,
        newPost:{content:'',platforms:[],date:'',time:''},
        filteredPosts(){
            if(this.filter==='all') return this.posts;
            return this.posts.filter(p=>p.status===this.filter);
        },
        schedulePost(){
            if(!this.newPost.content||this.newPost.platforms.length===0){alert('Add content and select at least one platform.');return;}
            if(!this.newPost.date||!this.newPost.time){alert('Set a date and time to schedule.');return;}
            if(this.editingPostId){
                var p=this.posts.find(x=>x.id===this.editingPostId);
                if(p){p.content=this.newPost.content;p.platforms=[...this.newPost.platforms];p.scheduled_at=this.newPost.date+' '+this.newPost.time;}
                this.editingPostId=null;
            } else {
                this.posts.unshift({id:Date.now(),content:this.newPost.content,platforms:[...this.newPost.platforms],scheduled_at:this.newPost.date+' '+this.newPost.time,status:'scheduled',analytics:null});
            }
            this.newPost={content:'',platforms:[],date:'',time:''};this.showComposer=false;
        },
        postNow(){
            if(!this.newPost.content||this.newPost.platforms.length===0){alert('Add content and select at least one platform.');return;}
            if(this.editingPostId){
                var p=this.posts.find(x=>x.id===this.editingPostId);
                if(p){p.content=this.newPost.content;p.platforms=[...this.newPost.platforms];p.scheduled_at=null;p.status='published';p.analytics={views:0,likes:0,shares:0,comments:0,engagement:0};}
                this.editingPostId=null;
            } else {
                this.posts.unshift({id:Date.now(),content:this.newPost.content,platforms:[...this.newPost.platforms],scheduled_at:null,status:'published',analytics:{views:0,likes:0,shares:0,comments:0,engagement:0}});
            }
            this.newPost={content:'',platforms:[],date:'',time:''};this.showComposer=false;
        },
        editPost(post){
            this.editingPostId=post.id;
            this.newPost={content:post.content,platforms:[...post.platforms],date:post.scheduled_at?post.scheduled_at.split(' ')[0]:'',time:post.scheduled_at?post.scheduled_at.split(' ')[1]:''};
            this.showComposer=true;
        },
        deletePost(id){
            this.posts=this.posts.filter(p=>p.id!==id);
        }
    };
}
