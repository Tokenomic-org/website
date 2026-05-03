/* Extracted from dashboard/leaderboard.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function leaderboardPage() {
    return {
        tab:'leaderboard',
        students:[
            {id:1,display_name:'CryptoScholar',wallet:'0xA1b2...C3d4',xp:4850,completed:8,total_courses:10,streak:45,badges:['DeFi Master','Top 1%']},
            {id:2,display_name:'TokenExplorer',wallet:'0xE5f6...G7h8',xp:3920,completed:6,total_courses:10,streak:32,badges:['Yield Farmer']},
            {id:3,display_name:'DeFiNinja',wallet:'0xI9j0...K1l2',xp:3540,completed:5,total_courses:10,streak:28,badges:['Security Expert']},
            {id:4,display_name:'BlockBuilder',wallet:'0xM3n4...O5p6',xp:2800,completed:4,total_courses:10,streak:15,badges:['Smart Contract Dev']},
            {id:5,display_name:'YieldHunter',wallet:'0xQ7r8...S9t0',xp:2340,completed:4,total_courses:10,streak:12,badges:['LP Provider']},
            {id:6,display_name:'ChainAnalyst',wallet:'0xU1v2...W3x4',xp:1980,completed:3,total_courses:10,streak:8,badges:['Data Wizard']},
        ],
        topThree:[],
        myProgress:{ totalXP:2340, coursesCompleted:4, streak:12, rank:5,
            courses:[
                {id:1,title:'Introduction to DeFi',progress:100,modules_completed:12,total_modules:12},
                {id:2,title:'Tokenomics Design',progress:75,modules_completed:6,total_modules:8},
                {id:3,title:'Smart Contract Security',progress:40,modules_completed:4,total_modules:10},
            ]
        },
        moduleTracker:[{
            id:1,title:'Introduction to DeFi',
            modules:[
                {index:0,title:'What is DeFi?',xp:50,completed:true},{index:1,title:'Blockchain Fundamentals',xp:50,completed:true},
                {index:2,title:'Wallets & Keys',xp:75,completed:true},{index:3,title:'DEX vs CEX',xp:75,completed:true},
                {index:4,title:'Liquidity Pools',xp:100,completed:true},{index:5,title:'Lending Protocols',xp:100,completed:true},
                {index:6,title:'Stablecoins',xp:75,completed:true},{index:7,title:'Governance & DAOs',xp:100,completed:false},
            ]
        }],
        init() { this.topThree=this.students.slice(0,3); },
        toggleModule(cid,mi) {
            const c=this.moduleTracker.find(x=>x.id===cid);
            if(c){const m=c.modules.find(x=>x.index===mi);if(m){m.completed=!m.completed;this.myProgress.totalXP+=m.completed?m.xp:-m.xp;}}
        }
    };
}
