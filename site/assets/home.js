(async function () {
  'use strict';
  const C=window.VocabCore, B=window.VocabBooks, L=window.VocabLearning, $=id=>document.getElementById(id), esc=B.esc;
  let user, request=0, pool=[], resume=null, due=[];
  const buttons=['todayBtn','dueBtn','newBtn','continueBtn'];
  function renderHeatmap(daily) {
    const heatmapGrid=$('heatmapGrid'), heatmapMonths=$('heatmapMonths'), heatmapWeekdays=$('heatmapWeekdays');
    const heatmapStats=$('heatmapStats'), heatmapLegend=$('heatmapLegend');
    const todayStr=C.dateKey(), dailyGoal=Number(daily.dailyGoal)||50;
    const dayHistory={...(daily.history||{})};
    // Older records may only contain today's counter. Display it without rewriting storage.
    if (!dayHistory[todayStr] && daily.today===todayStr && daily.dailyCount>0) dayHistory[todayStr]=daily.dailyCount;
    if (!heatmapGrid) return;
    const g = C.buildGrid(dayHistory, { weeks: 53, goal: dailyGoal, today: todayStr });
    const s = C.streaks(dayHistory, g.todayKey);

    heatmapMonths.innerHTML = g.months.map(m => `<span class="hm-month">${m}</span>`).join('');

    heatmapGrid.innerHTML = g.cols.map(col =>
      `<div class="hm-col">${col.map(d => {
        let cls = `hm-cell lv${d.level}`;
        if (d.pad || d.future) cls += ' blank';
        if (d.today) cls += ' today';
        const p = d.key.split('-');
        const tip = (d.pad || d.future) ? '' :
          ` title="${+p[0]}年${+p[1]}月${+p[2]}日 · 答对 ${d.count} 词${d.count ? ' · 目标 ' + dailyGoal : ''}"`;
        return `<div class="${cls}"${tip}></div>`;
      }).join('')}</div>`).join('');

    // 星期标签只标 一/三/五（行 1/3/5），与 GitHub 一致
    const wd = ['日', '一', '二', '三', '四', '五', '六'];
    heatmapWeekdays.innerHTML = wd.map((w, i) =>
      `<span class="hm-wd">${i % 2 === 1 ? w : ''}</span>`).join('');

    const th = g.thresholds;
    heatmapLegend.innerHTML =
      `<span class="hm-legend-label">少</span>` +
      [0, 1, 2, 3, 4].map(lv => {
        const tip = lv === 0 ? '0 词'
          : lv === 4 ? `≥ ${th[3]} 词（达标）`
          : `${th[lv - 1]}–${th[lv] - 1} 词`;
        return `<span class="hm-cell lv${lv}" title="${tip}"></span>`;
      }).join('') +
      `<span class="hm-legend-label">多</span>`;

    heatmapStats.innerHTML =
      `<span>累计答对 <b>${s.total}</b> 词</span>` +
      `<span>当前连续 <b>${s.current}</b> 天</span>` +
      `<span>最长连续 <b>${s.longest}</b> 天</span>` +
      `<span>最佳单日 <b>${s.best}</b> 词</span>` +
      `<span>活跃 <b>${s.activeDays}</b> 天</span>`;

    heatmapGrid.setAttribute('aria-label',
      `最近 ${g.weeks} 周学习日历，累计答对 ${s.total} 词，当前连续 ${s.current} 天`);
    return Number(dayHistory[todayStr]) || 0;
  }

  async function refresh() {
    const ticket=++request; buttons.forEach(id=>$(id).disabled=true);
    $('homeStatus').textContent='正在读取词书…';
    try {
      const daily=C.store.get(B.globalKey(user),{}) || {};
      $('todayCount').textContent=renderHeatmap(daily);
      L.seed(user);
      const book=B.current(), mode=$('homeMode').value;
      const words=(await Promise.all(book.chapters.map(c=>C.loadChapter(c.id)))).flatMap(c=>c.words);
      if(ticket!==request)return;
      const ids=new Set(words.map(w=>w.gk));
      due=L.due(user,book.id,mode).filter(w=>ids.has(w.gk));
      pool=L.unseen(user,words,mode);
      $('dueCount').textContent=due.length; $('unseenCount').textContent=pool.length;
      $('dueBtn').disabled=!due.length;$('newBtn').disabled=!pool.length;$('todayBtn').disabled=!(due.length||pool.length);
      $('todayBtn').textContent=due.length?'开始今日学习 · 先复习':'开始今日学习 · 新学 10 词';
      const records=L.list(user).filter(r=>ids.has(r.word.gk));
      const recognized=records.filter(r=>r.skills.choice?.stage>=3).length, spelled=records.filter(r=>r.skills.spelling?.stage>=3).length;
      $('masterySummary').textContent=`间隔复习已掌握：释义识别 ${recognized} 词 · 拼写 ${spelled} 词（至少跨日通过 3 个阶段）`;
      $('dueList').innerHTML=due.length?due.slice(0,30).map(w=>'<p><strong>'+esc(w.word)+'</strong> · '+esc(w.meaning)+'<br>'+L.describe(user,w).map(esc).join('<br>')+'</p>').join('')+(due.length>30?'<p>另有 '+(due.length-30)+' 词，进入复习后按组练习。</p>':''):'<p>当前模式暂无到期词。练习后会自动安排复习。</p>';
      resume=C.store.get(`ivocab-last:${user}`,null);
      if(!resume) {
        const candidate=['spelling','choice'].find(m=>C.store.get(B.stateKey(user,book.id)+(m==='choice'?':choice':''),null));
        if(candidate)resume={bookId:book.id,mode:candidate};
      }
      const lastBook=B.list().find(b=>b.id===resume?.bookId);
      const state=resume&&C.store.get(B.stateKey(user,resume.bookId)+(resume.mode==='choice'?':choice':''),null);
      if(lastBook&&state) {
        $('continueBtn').disabled=false;
        $('resumeText').textContent=`${lastBook.name} · ${resume.mode==='choice'?'识别释义':'拼写'} · 第 ${state.chapter||1} 章 · 第 ${(state.currentIndex||0)+1} 词`;
      } else {resume=null;$('resumeText').textContent='暂无练习进度';}
      $('homeStatus').textContent=`${book.name} · ${mode==='choice'?'识别释义':'拼写'} · 每次新学最多 10 词`;
      await B.flush();window.__HOME_READY=true;
    } catch(e) { if(ticket===request)$('homeStatus').textContent='读取失败：'+e.message; }
  }
  async function start(action, continued=false) {
    buttons.forEach(id=>$(id).disabled=true);
    try {
      const mode=continued?resume.mode:$('homeMode').value;
      if(continued)B.select(resume.bookId,user);
      await B.flush();location.href=(mode==='choice'?'choice.html':'spelling.html')+(action?'?session='+action:'');
    } catch(e) {$('homeStatus').textContent='尚未保存，未进入练习：'+e.message;await refresh();}
  }
  try {
    await B.init(); const users=C.loadUsers();user=users.active;
    $('homeUser').innerHTML=users.users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>').join('');$('homeUser').value=user;
    $('homeBook').innerHTML=B.list().map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');$('homeBook').value=B.active;
    $('homeUser').onchange=async()=>{user=$('homeUser').value;C.saveUsers(users.users,user);B.select(C.store.get(`ivocab-book-active:${user}`,'ielts'),user);$('homeBook').value=B.active;await refresh();};
    $('homeBook').onchange=()=>{B.select($('homeBook').value,user);refresh();};
    $('homeMode').onchange=refresh;
    $('todayBtn').onclick=()=>start(due.length?'due':'new');$('dueBtn').onclick=()=>start('due');$('newBtn').onclick=()=>start('new');$('continueBtn').onclick=()=>resume&&start('',true);
    await refresh();
    setInterval(()=>{if(!document.hidden)refresh();},60000);
  } catch(e) {$('homeStatus').textContent='初始化失败：'+e.message;}
})();
