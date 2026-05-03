/* Extracted from dashboard/revenue.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function revenuePage() {
    return {
        transactions:[],totalRevenue:'0.00',monthlyRevenue:'0.00',balance:'0.00',txCount:0,
        chartRange:'ALL',trendChart:null,sourceChart:null,
        chartData:{
            '1W':{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],gross:[180,210,95,320,150,0,285],share:[162,189,86,288,135,0,257]},
            '1M':{labels:['Week 1','Week 2','Week 3','Week 4'],gross:[680,920,1050,1240],share:[612,828,945,1116]},
            '3M':{labels:['Apr','May','Jun'],gross:[720,890,1240],share:[648,801,1116]},
            'YTD':{labels:['Jan','Feb','Mar','Apr','May','Jun'],gross:[320,480,560,720,890,1240],share:[288,432,504,648,801,1116]},
            'ALL':{labels:['Q3 2025','Q4 2025','Jan','Feb','Mar','Apr','May','Jun'],gross:[120,240,320,480,560,720,890,1240],share:[108,216,288,432,504,648,801,1116]}
        },
        async init() {
            this.transactions=await TokenomicSupabase.getRevenue();
            const arr=Array.isArray(this.transactions)?this.transactions:[];
            this.totalRevenue=arr.reduce((s,t)=>s+parseFloat(t.amount_usdc||0),0).toFixed(2);
            this.txCount=arr.length;
            if(TokenomicWallet.account) this.balance=await TokenomicWallet.getUSDCBalance();
            this.renderCharts();
        },
        updateChart() {
            if(this.trendChart) this.trendChart.destroy();
            const d=this.chartData[this.chartRange];
            const t=document.getElementById('revenueTrendChart');
            if(!t) return;
            const ctx=t.getContext('2d');
            const gradient=ctx.createLinearGradient(0,0,0,300);
            gradient.addColorStop(0,'rgba(255,96,0,0.25)');
            gradient.addColorStop(1,'rgba(255,96,0,0.02)');
            this.trendChart=new Chart(t,{type:'line',data:{labels:d.labels,datasets:[
                {label:'Gross Revenue',data:d.gross,borderColor:'#ff6000',backgroundColor:gradient,fill:true,tension:0.4,borderWidth:2,pointBackgroundColor:'#ff6000',pointRadius:4,pointHoverRadius:6},
                {label:'Your Share (90%)',data:d.share,borderColor:'#00a651',borderDash:[5,5],tension:0.4,borderWidth:2,pointRadius:0}
            ]},options:{responsive:true,interaction:{intersect:false,mode:'index'},plugins:{legend:{labels:{color:'#5a8299',usePointStyle:true}},tooltip:{backgroundColor:'#001f29',titleColor:'#fff',bodyColor:'#fff',padding:12,cornerRadius:8,displayColors:true}},scales:{y:{ticks:{color:'#5a8299',callback:function(v){return '$'+v}},grid:{color:'rgba(0,0,0,0.05)'}},x:{ticks:{color:'#5a8299'},grid:{display:false}}}}});
        },
        renderCharts() {
            this.updateChart();
            if(this.sourceChart) this.sourceChart.destroy();
            const s=document.getElementById('revenueSourceChart');
            if(s) this.sourceChart=new Chart(s,{type:'doughnut',data:{labels:['Courses','Consultations','Events','Sponsorships'],datasets:[{data:[1450,875,350,1750],backgroundColor:['#F7931A','#00C853','#2196F3','#FF8F00'],borderWidth:0,hoverOffset:8}]},options:{responsive:true,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#8899A6',padding:12,usePointStyle:true,font:{family:'Inter'}}}}}});
            const sd=document.getElementById('splitDoughnut');
            if(sd){new Chart(sd,{type:'doughnut',data:{labels:['Educator (90%)','Treasury (5%)','Rewards (5%)'],datasets:[{data:[90,5,5],backgroundColor:['#00C853','#F7931A','#2196F3'],borderWidth:2,borderColor:'#fff',hoverOffset:6}]},options:{responsive:true,cutout:'60%',plugins:{legend:{display:false},tooltip:{backgroundColor:'#0A0F1A',padding:10,cornerRadius:8,titleFont:{family:'Inter'},bodyFont:{family:'Inter'}}}}});}
        },
        exportCSV() {
            const arr=Array.isArray(this.transactions)?this.transactions:[];
            if(!arr.length){alert('No transactions to export.');return;}
            let csv='TX Hash,Description,Gross (USDC),Your Share,Treasury,Rewards,Status,Date\n';
            arr.forEach(tx=>{
                const gross=parseFloat(tx.amount_usdc||0);
                csv+=`${tx.tx_hash},${tx.description},${gross},${(gross*0.9).toFixed(2)},${(gross*0.05).toFixed(2)},${(gross*0.05).toFixed(2)},${tx.status},${new Date(tx.created_at).toLocaleDateString()}\n`;
            });
            const blob=new Blob([csv],{type:'text/csv'});
            const url=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=url;a.download='tokenomic-revenue-'+new Date().toISOString().split('T')[0]+'.csv';
            document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
        }
    };
}

(function(){
                  function fmt(n){ var x=Number(n||0); return (Math.round(x*100)/100).toFixed(2); }
                  function ready(fn){ if(document.readyState!='loading')fn(); else document.addEventListener('DOMContentLoaded',fn); }
                  function addr(){ try{return window.TokenomicWallet && window.TokenomicWallet.getAddress();}catch(e){return null;} }

                  async function loadEarnings(){
                    if (!window.TokenomicAssets) return;
                    var a = addr();
                    if (!a) { document.getElementById('tkn-earnings-pending').textContent='— USDC'; return; }
                    try {
                      var e = await window.TokenomicAssets.getEducatorEarnings(a);
                      document.getElementById('tkn-earnings-pending').textContent = fmt(e.pendingFormatted) + ' USDC';
                      document.getElementById('tkn-earnings-lifetime').textContent = fmt(e.totalEarnedFormatted) + ' USDC';
                    } catch(err){ console.warn(err); }
                  }
                  async function loadCourses(){
                    var slot = document.getElementById('tkn-my-courses');
                    var a = addr(); if (!a || !window.TokenomicAssets) return;
                    slot.textContent = 'Loading…';
                    var list = await window.TokenomicAssets.getEducatorCourses(a);
                    if (!list.length){ slot.innerHTML='<em>No courses registered yet. Publish one from the Courses tab.</em>'; return; }
                    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.88rem;"><thead><tr style="text-align:left;color:#5a8299;border-bottom:1px solid #e8eef5;"><th style="padding:6px 4px;">#</th><th>Price</th><th>Active</th><th>Metadata</th></tr></thead><tbody>';
                    list.forEach(function(c){
                      html += '<tr style="border-bottom:1px solid #f0f4fa;"><td style="padding:8px 4px;">'+c.courseId+'</td><td>'+c.priceFormatted+' USDC</td><td>'+(c.active?'<span style="color:#00C853;">●</span> live':'<span style="color:#999;">○</span> off')+'</td><td><a href="'+c.ipfsUrl+'" target="_blank" rel="noopener">IPFS</a></td></tr>';
                    });
                    slot.innerHTML = html + '</tbody></table>';
                  }
                  async function loadSales(){
                    var slot = document.getElementById('tkn-my-sales');
                    var a = addr(); if (!a || !window.TokenomicAssets) return;
                    slot.textContent = 'Loading…';
                    var sales = await window.TokenomicAssets.getEducatorSales(a);
                    if (!sales.length){ slot.innerHTML='<em>No sales yet.</em>'; return; }
                    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.86rem;"><thead><tr style="text-align:left;color:#5a8299;border-bottom:1px solid #e8eef5;"><th style="padding:6px 4px;">Course</th><th>Buyer</th><th>You earned</th><th>Cert</th><th>Tx</th></tr></thead><tbody>';
                    sales.slice(0,25).forEach(function(s){
                      var b = s.buyer.slice(0,6)+'…'+s.buyer.slice(-4);
                      var certCell = (s.certificateTokenId && s.certificateTokenId !== '0')
                        ? '#'+s.certificateTokenId
                        : '<span style="color:#9aa6b2;">unclaimed</span>';
                      html += '<tr style="border-bottom:1px solid #f0f4fa;"><td style="padding:8px 4px;">#'+s.courseId+'</td><td><code style="font-size:0.78rem;">'+b+'</code></td><td>'+s.educatorAmount+' USDC</td><td>'+certCell+'</td><td><a href="'+s.explorerUrl+'" target="_blank" rel="noopener">view</a></td></tr>';
                    });
                    slot.innerHTML = html + '</tbody></table>';
                  }
                  async function withdraw(){
                    var btn = document.getElementById('tkn-withdraw-btn');
                    var status = document.getElementById('tkn-withdraw-status');
                    if (!window.TokenomicAssets){ status.innerHTML='<span style="color:#e53e3e;">Web3 not loaded</span>'; return; }
                    btn.disabled = true; status.innerHTML='Estimating gas…';
                    try {
                      // Show gas estimate before requesting signature so the user is never surprised.
                      var est = await window.TokenomicAssets.estimateActionGas('withdraw', {});
                      var gasMsg = est && est.message ? est.message : 'You will pay the gas for this withdrawal on Base.';
                      if (!confirm(gasMsg + '\n\nProceed with the withdrawal?')) {
                        status.innerHTML = '<span style="color:#5a8299;">Cancelled.</span>';
                        return;
                      }
                      status.innerHTML = 'Submitting transaction… (you pay the gas)';
                      var r = await window.TokenomicAssets.withdrawEarnings();
                      status.innerHTML = '<span style="color:#00C853;">✓ Withdrew '+r.amount+' USDC. Gas paid by you.</span> <a href="'+r.explorerUrl+'" target="_blank" rel="noopener">View on BaseScan →</a>';
                      loadEarnings();
                    } catch(err){
                      status.innerHTML = '<span style="color:#e53e3e;">'+(err && err.message || err)+'</span>';
                    } finally { btn.disabled = false; }
                  }
                  function refreshAll(){ loadEarnings(); loadCourses(); loadSales(); }
                  ready(function(){
                    document.getElementById('tkn-withdraw-btn').addEventListener('click', withdraw);
                    document.getElementById('tkn-earnings-refresh').addEventListener('click', refreshAll);
                    window.addEventListener('tokenomic:wallet-connected', refreshAll);
                    setTimeout(refreshAll, 1500);
                  });
                })();
