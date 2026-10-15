/* Agora · 雅典广场 —— 大厅 / 辩论室 / 结算 三视图状态机（原生 JS，零依赖零构建） */
(() => {
  'use strict';

  // 本地（无 agora.config.js 注入）走 location.origin；线上 Vercel 页面由
  // public/agora.config.js 把 Render 后端域名写进 window.__AGORA_API_BASE__
  const BASE = window.__AGORA_API_BASE__ || location.origin;
  const FIRST_TOKEN_TIMEOUT = 12000; // 免费云冷启动：12s 无首字提示重试
  const MAX_RETRY = 2;
  const HISTORY_KEY = 'agora.history.v1';
  /* ── 试玩模式常量（零 API 消耗）── */
  const DEMO_TYPE_MS = 30; // 打字机：每字 30ms，约 150 字 ≈ 4.5s，贴近真实流式节奏
  const DEMO_THINK_MS = 1500; // 「思考中」三点动画前摇，模拟大模型延迟
  // 与 public/demo-dialogues.json 同源同内容：file:// 双击打开 / fetch 被拦时兜底，断网也能玩
  const DEMO_FALLBACK = {"version":2,"note":"Agora 试玩剧本：零 API 消耗，纯本地。label 的 [动作] 是舞台提示，前端斜体渲染；C 选项固定为离题/挑衅，演示先贤的性格化应对。","topicTitle":"人性本善还是本恶","scripts":{"plato":{"name":"柏拉图","topicTitle":"人性本善还是本恶","opening":"你说人性本善还是本恶——且慢，你先得告诉我：你所说的「善」，是那个在一切情形中保持同一的善本身，还是众人此刻碰巧称赞的那种行为？那不过是影子。我问你：一个人在无人处不行恶，是因为他见过善本身，还是因为他怕影子里的法律？想清楚这个，我们再谈善恶。","rounds":[{"options":[{"id":"a","label":"[向前一步] 善恶不在行为里，在行为背后的那个「相」里","reply":"你说得对，善恶不在行为里，在行为背后的那个相里。可你既同意这一点，为何又说人生来有恶？灵魂在降入身体之前，见过善本身；恶不是天生的，是灵魂忘了自己见过什么。教育是什么？是转头。你现在怕的，不过是光刺眼。"},{"id":"b","label":"[环顾四壁] 可你怎么证明洞外有光？","reply":"你要证明？好吧。你见过完全相等的两棵树吗？没有，可「相等」本身在你心里。善也是如此——它不是从经验里攒出来的，因为它不住在任何经验里。若人性本恶，你从何处得来「恶」这个判断的标准？标准不在影子里，在光里。"},{"id":"c","label":"[摊开双手] 我没想好怎么答","reply":"你说「没想好」——这话我听见了，也不急着驳你。可你站在这辩题的一边，脚下却是空的。没想好，可以想；但别把没想好当作答案。我问的仍是那个老问题：善本身，你可曾隔着身体的影子，瞥见过一眼？"}]},{"options":[{"id":"a","label":"[迟疑] 那善恶各半，总可以吧？","reply":"各半？那是最偷懒的算法。半善半恶的不是人，是一盆调坏了的颜料。灵魂要么朝向光，要么背对光，没有半转过头来的道理。你说的各半，其实是「有时醒着有时睡着」——可睡着的人，不记得自己醒着时见过什么。"},{"id":"b","label":"[反问] 可人生来就趋利避害","reply":"趋利？你看见的是影子在壁上的走向。婴儿抓东西，不是趋利，是求生；成人逐利，是忘了为何求生。你说这是天生，我说这是遗忘。差别在此：一个认之为本性，一个认之为遗忘。遗忘可以治，本性不可移——你选哪一个？"},{"id":"c","label":"[提高声调] 你先证明你不是在诡辩","reply":"诡辩？诡辩是玩弄词的人干的事，我追问的恰是词背后的东西。你扣我一顶帽子，帽子是影子，不是光。若你真想辨清，就把帽子放下，回答我：你所说的「天生」，是灵魂堕落之后的天生，还是降生之初的天生？"}]}],"closing":"我们走到这里，善恶仍未分。可你我已不同来时的路——你开始追问定义，这便是转向。人性本善还是本恶？善是回忆，恶是遗忘。其余的话，等你在光里站定了再说。"},"aristotle":{"name":"亚里士多德","topicTitle":"人性本善还是本恶","opening":"人性本善还是本恶？我们首先必须定义：你说的「性」是什么？是天赋的质料，还是习惯养成的德性？正如我们所见，一颗橡籽无所谓善恶，它只是潜在。人也是这样——德性不在天性里，在反复的作为里。我们按类来说：善，是灵魂合乎美德的活动；恶，是其缺失。请你就着这个定义驳我。","rounds":[{"options":[{"id":"a","label":"[点头] 同意，善恶由后天养成","reply":"好，你抓住了要害。可你既说后天，又说「本性」，这便自相矛盾。质料因无善恶，形式因才有。一个人的「性」，在他成为「这一个」之前，只是可能。我们所见的一切善人，都不是天生的善人，是做成的善人——正如我们所见，雕刻家不生于石头。"},{"id":"b","label":"[蹙眉] 可有人天生就残暴","reply":"残暴？你把手段当成了目的。按照三段论来走：大前提，德性在于中道；小前提，残暴是过度的量；结论，它是恶的一种。可这不是「天生」——没有人天生带着中道的知识，也没有人天生带着过度的量，二者都是习惯。你说天生，我问你：婴儿可曾残暴过？"},{"id":"c","label":"[摆手] 我不关心定义，只说感受","reply":"你说只谈感受——这话我听见了。可感受是质料，不是论证。按照三段论，你的结论跑在了大前提前面。我并非要你背熟定义，我是要你看见：不定义「善」，你我谈的就不是同一件事。先定义，再谈别的，这不迟。"}]},{"options":[{"id":"a","label":"[沉吟] 那善恶由城邦决定？","reply":"城邦？人是政治的动物，这话我说过。可你把关系弄倒了：城邦立法不是善的来源，是对善的模仿。按照我们刚才的定义，合乎美德的活动在先，法律只是把它写下来。若法律定善，改一条法律，善就变了——你愿意这么说吗？"},{"id":"b","label":"[拱手] 那德性能教吗？","reply":"能教，也不能教。作为知识，它能教；作为习惯，它只能练。这要区分来说：一个人听了中道的道理而不练，如同学了医术不上临床。苏格拉底说德性即知识，我敬他，可我认为他漏掉了习惯这一半。你呢？你打算练，还是打算听？"},{"id":"c","label":"[环视廊下] 这些概念都是人定的","reply":"人定的？那我们此刻为什么能互相听懂？共同的概念若人定，你我说的就不是一个词。你抛下这句话，其实偷偷用了一个非人定的东西——「共同」本身。我不驳你，我只请你回答：这个人定的「善」，是谁定的？他凭什么是那个人？"}]}],"closing":"好，我们到此为止。性无善恶，习以成之——这是你要带走的橡籽。其余的枝叶，等你在吕克昂的廊下多走几遍，我们再来谈。"},"pythagoras":{"name":"毕达哥拉斯","topicTitle":"人性本善还是本恶","opening":"万物皆数，这你是知道的。人性本善还是本恶？且先告诉我：你所说的善，是一，还是多？这其中的比例是几比几？如同里拉琴的弦，太紧则裂，太松无声——人心也是一个多，善恶之争，是它内部的数失了和谐。你站在这边，可曾量过：你那个立场，是几比几？","rounds":[{"options":[{"id":"a","label":"[侧首] 善恶怎么量？","reply":"问得好。量不在秤上，在秩序里。一个灵魂若让理性为一、欲望为多，那比例便乱了套。一与多，有限与无限——恶不是多了一种东西，是多的部分越了位。如同里拉琴的弦，音没错，是弦的比错了。你先量自己：昨日你发怒时，是几比几？"},{"id":"b","label":"[若有所悟] 善恶是灵魂的和谐与失和","reply":"你摸到门了。和谐不是没有对立，是对立各在其位。可你既说失和是天生的，我问你：天球运行失过轨吗？天体的数不会错，人的数会错，错在习惯，不在天性。灵魂进入身体时带着从前的数——你忘了从前来处，才会把失和当作本性。"},{"id":"c","label":"[狐疑] 数能解释一切吗？","reply":"你说「一切」——这我便不敢认了。有些事不是说给所有人听的。可你这句话本身，却得用数来说：「一切」是一，「不能」也是一。你把一让给了我。回到辩题：善恶之争，你若不肯量，我便无从开口。"}]},{"options":[{"id":"a","label":"[正色] 那人要做的就是恢复和谐","reply":"恢复，这个词用得好。轮回中的灵魂，数是被扰乱的，德性是重新调弦。先守规矩，再问为什么——戒律不是捆你，是帮你把弦音稳住。不食豆、不语浮言，都是调弦的法子。你既说要恢复，从今夜起，你守哪一条？"},{"id":"b","label":"[追问] 那和谐有标准吗？","reply":"有。八度二比一，五度三比二——这不是我定的，是我听见的。你听两根弦，三比二时，耳朵自然安适。标准不在我这儿，在数里。人心也一样：合乎比例时，它自己知道。你说没标准，是你的耳朵只听见响声，听不见比例。"},{"id":"c","label":"[摊手] 我不信轮回，只谈今生","reply":"信与不信，随你。可你这句话里已经有一个数：「只」是一，「今生」也是一。灵魂若只活一次，和谐与失和都一样收场，你为何还在意善恶？你在意的本身，就证明你知道有分别。分别不在今生，在弦的比里。"}]}],"closing":"量你的比例，守你的规矩。天球在唱歌，你听惯了这歌声，便以为没有歌声——那不是没有，是你忘了听。去吧，先从一与多开始。"},"confucius":{"name":"孔子","topicTitle":"人性本善还是本恶","opening":"你说这个，且说说看。诗云：如切如磋——做人这件事，是要反复打磨的。性相近也，习相远也。善与不善，不是天生的，是学出来的、养出来的。君子求诸己，小人求诸人。你问人性，先问问自己做了什么。慢慢说，我听着。","rounds":[{"options":[{"id":"a","label":"[拱手] 同意，善恶由后天习得","reply":"你这后生，算是摸着门了。可为仁由己——不是你今日点了头，便成了。我看人，不看他说什么，看他行什么。子路勇，勇过了头便是莽；冉有怯，怯过了头便是退。我待他们不同，因材而已。你既说习得，从今日起，你行哪一件？"},{"id":"b","label":"[困惑] 可有人天生就坏","reply":"非也。你说天生就坏，那是把「习」当成了「性」。我未见好仁者恶不仁者——不是没有，是少见。少见，不是天生。一个人成了什么样，看他近的是什么人，守的是什么礼。你与其论断人天生如何，不如问问：他身边可曾有君子？"},{"id":"c","label":"[局促] 我不知道该说什么","reply":"不知道便不知道，这很好。知之为知之，不知为不知，是知也。可你别拿不知道当挡箭牌——我问过你一次了，你站在这辩题一边，总有个缘故。说说看，这个缘故是什么？说不出来，我们就把这件事放下，先去做一件事。"}]},{"options":[{"id":"a","label":"[试探] 那善恶由礼决定？","reply":"礼？人而不仁，如礼何？礼是仁走的路，不是仁的源头。君君臣臣，名分乱了才讲正名。你说礼定善恶，那是把路当成了家。我且问你：一个守礼而不仁的人，和一个不守礼而仁的人，你与哪一个相处？"},{"id":"b","label":"[请教] 那仁怎么检验？","reply":"己所不欲，勿施于人——就在这一句里。你把不想受的，加诸别人，那不仁；你不加诸，便是仁之始。检验不难，难在日日如此。我七十而随心所欲，不逾矩——你今日且试一件：把你刚才驳我那句话，收回去一半，试试什么滋味？"},{"id":"c","label":"[不以为然] 您那套过时了","reply":"过时？这话我听得不少。可我没说过「我这套」，我说的是「古人如此」。述而不作，信而好古。太阳底下，人心没有新鲜事——你说过时，是哪个时辰、哪件事上过时了？说给我听。若真过时，我改；若说不出来，回去读书。"}]}],"closing":"罢了。性相近，习相远——你带走这六个字，比带走一百句辩论强。为仁由己，勉之而已。"},"laozi":{"name":"老子","topicTitle":"人性本善还是本恶","opening":"你问这个？我说，你问反了。大道废，有仁义——等到人人把善恶讲得响亮，那道早已缺了。你说性本善，我说婴孩最接近道，因为他还没有学会分别。上善若水，水不争高低，专往低处去，万物却因它而生。不如先把问题放下，听风怎么过山谷。","rounds":[{"options":[{"id":"a","label":"[轻声] 那道是善还是恶？","reply":"道不仁。天地不仁，以万物为刍狗——那不是残忍，是不偏爱。你问善恶，是在分别里打转。它不动，你替它急什么？你说善，我说「善」字出口时，已经落了第二层。第一层那个东西，说不出，一说便错。你且坐，看云。"},{"id":"b","label":"[点头] 那人该顺应自然","reply":"顺应？这话对了一半。另一半是：你「顺应」时那个「想顺应」的念头，正是不顺应。反者道之动——你越用力抓，它跑得越快。无为不是不做，是不妄为。你见过哪个季节发号施令吗？没有。可四时从未误过一次。你急，是你把钟表当成了天。"},{"id":"c","label":"[直言] 您这不是回避问题吗？","reply":"回避？你追一个答案，追了十里地。我说那答案在你出发的地方——这不是回避，是你跑反了。你若一定要问：不争，能不能赢？这话你答不上来，就先坐着。答得上，你也不必再问善恶。"}]},{"options":[{"id":"a","label":"[追问] 那善恶之争有意义吗？","reply":"有意义，也没意义。众人争它，如争影子长短——争到手，天也黑了。可你若不争，连「不争」也成了一个执念。知其白，守其黑。你知道这是白的，守住黑的那一边，话就说到这里。再说，是画蛇添足。"},{"id":"b","label":"[恍然] 那人该柔弱处世","reply":"人之生也柔弱，其死也坚强。草木生时柔软，死后枯槁——柔弱不是软弱，是活着的力量。你学过水吗？抽刀断水水更流。它从不赢，可从不败。你说处世，是处世给谁看？给众人看，是刚；给自己活，是柔。你选哪一个？"},{"id":"c","label":"[苦笑] 听不懂您在说什么","reply":"听不懂，比听不懂装懂好。道可道，非常道——我说出来的，都不是它。你听懂了字，便输了意思；你没听懂，反而离它近了些。这样吧，今夜你别想它，明早看草叶上的水珠——那里面什么都有，什么都不是。回来我们再谈。"}]}],"closing":"大道甚夷，而人好径。你走了这一趟，算是走过了一条弯路——弯路也是路。归根曰静。去吧。"}}};
  const MOOD_LABEL = { calm: '平静', amused: '饶有兴致', impressed: '赞赏', irritated: '不悦', reflective: '沉思' };

  const $ = (id) => document.getElementById(id);

  /* ── 历史 store（localStorage 元数据；消息以服务端为准） ── */
  const store = {
    list() {
      try {
        const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    },
    save(all) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, 30)));
    },
    add(entry) {
      const all = store.list();
      all.unshift(entry);
      store.save(all);
    },
    update(debateId, patch) {
      const all = store.list();
      const it = all.find((h) => h.debateId === debateId);
      if (it) {
        Object.assign(it, patch, { updatedAt: Date.now() });
        store.save(all);
      }
    },
    remove(debateId) {
      store.save(store.list().filter((h) => h.debateId !== debateId));
    },
    clear() {
      localStorage.removeItem(HISTORY_KEY);
    },
  };

  /* ── 全局状态 ── */
  const state = {
    personas: [],
    topics: [],
    topicCat: 'all',
    pick: { personaKey: null, topicId: null, stance: 'pro', maxRounds: 6 },
    debate: null, // { id, persona, topic, round, status, seq }
    verdict: null,
    busy: false,
    mode: 'demo', // 'demo' 试玩（零消耗，本地剧本）| 'deep' 深度（智谱 API + SSE）
    demoScript: null,
    demoBusy: false,
  };

  /* ── 视图切换 ── */
  function showView(name) {
    for (const v of ['lobby', 'debate', 'result']) {
      $('view-' + v).hidden = v !== name;
    }
    window.scrollTo(0, 0);
  }

  function setAccent(persona) {
    document.documentElement.style.setProperty('--accent', persona.accent);
  }

  /* ── 大厅渲染 ── */
  function renderPersonas() {
    const rail = $('persona-cards');
    rail.innerHTML = '';
    for (const p of state.personas) {
      const card = document.createElement('button');
      card.className = 'persona-card' + (p.key === state.pick.personaKey ? ' on' : '');
      card.style.setProperty('--card-accent', p.accent);
      card.dataset.key = p.key;

      const glyph = document.createElement('div');
      glyph.className = 'glyph';
      glyph.textContent = p.glyph;
      const name = document.createElement('div');
      name.className = 'p-name';
      name.textContent = p.name;
      const era = document.createElement('div');
      era.className = 'p-era';
      era.textContent = p.era;
      const line = document.createElement('div');
      line.className = 'p-line';
      line.textContent = p.oneLiner;

      card.append(glyph, name, era, line);
      card.onclick = () => {
        state.pick.personaKey = p.key;
        setAccent(p);
        renderPersonas();
        syncBeginBtn();
      };
      rail.appendChild(card);
    }
  }

  function renderTopics() {
    const box = $('topic-list');
    box.innerHTML = '';
    const items =
      state.topicCat === 'all'
        ? state.topics
        : state.topics.filter((t) => t.category === state.topicCat);
    for (const t of items) {
      const b = document.createElement('button');
      b.className = 'topic-item' + (t.id === state.pick.topicId ? ' on' : '');
      const title = document.createElement('div');
      title.className = 't-title';
      title.textContent = t.title;
      const meta = document.createElement('div');
      meta.className = 't-meta';
      const cat = document.createElement('span');
      cat.className = 't-cat ' + t.category;
      cat.textContent = t.category === 'contemporary' ? '当代' : '传统';
      meta.appendChild(cat);
      for (const tag of t.tags || []) {
        const s = document.createElement('span');
        s.textContent = tag;
        meta.appendChild(s);
      }
      b.append(title, meta);
      b.onclick = () => {
        state.pick.topicId = t.id;
        renderTopics();
        syncBeginBtn();
      };
      box.appendChild(b);
    }
  }

  function renderHistory() {
    const box = $('history-list');
    box.innerHTML = '';
    const list = store.list();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '还没有对局。选一位先贤，开始第一场辩论。';
      box.appendChild(empty);
      return;
    }
    for (const h of list) {
      const item = document.createElement('button');
      item.className = 'history-item' + (h.dead ? ' dead' : '');
      item.style.setProperty('--card-accent', h.accent);
      const g = document.createElement('div');
      g.className = 'h-glyph';
      g.textContent = h.glyph;
      const main = document.createElement('div');
      main.className = 'h-main';
      const title = document.createElement('div');
      title.className = 'h-title';
      title.textContent = `${h.personaName} · ${h.topicTitle}`;
      const sub = document.createElement('div');
      sub.className = 'h-sub';
      const d = new Date(h.updatedAt || h.createdAt);
      sub.textContent = `${h.maxRounds} 回合 · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      main.append(title, sub);
      const st = document.createElement('span');
      st.className = 'h-state ' + (h.dead ? 'dead' : h.status);
      st.textContent = h.dead ? '已消散' : h.status === 'done' ? '已终结' : '进行中';
      item.append(g, main, st);
      item.onclick = () => (h.dead ? removeHistory(h) : resumeDebate(h));
      box.appendChild(item);
    }
  }

  function removeHistory(h) {
    store.remove(h.debateId);
    renderHistory();
  }

  function syncBeginBtn() {
    $('btn-begin').disabled = !(state.pick.personaKey && state.pick.topicId) || state.busy;
  }

  /* ── 辩论室：消息渲染 ── */
  function addSys(text, cls) {
    const d = document.createElement('div');
    d.className = cls || 'sys';
    d.textContent = text;
    $('log').appendChild(d);
    scrollLog();
    return d;
  }

  function scrollLog() {
    const log = $('log');
    log.scrollTop = log.scrollHeight;
  }

  function addBubble(role, mood) {
    const persona = currentPersona();
    const row = document.createElement('div');
    row.className = 'row ' + (role === 'sage' ? 'sage' : 'me');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'sage' ? persona.glyph : '我';
    if (role !== 'sage') avatar.style.background = '#5b7ba6';

    const col = document.createElement('div');
    col.className = 'col';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = role === 'user' ? '你' : persona.name;
    if (role === 'sage') {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'AI';
      who.appendChild(b);
      const m = MOOD_LABEL[mood] || mood;
      if (m && m !== '平静') {
        const ms = document.createElement('span');
        ms.className = 'mood';
        ms.textContent = m;
        who.appendChild(ms);
      }
    }
    const body = document.createElement('div');
    body.className = 'bubble' + (role === 'sage' ? ' streaming' : '');
    col.append(who, body);
    row.append(avatar, col);
    $('log').appendChild(row);
    scrollLog();
    return body;
  }

  /** 渲染一条已存消息（历史恢复用） */
  function renderStoredMessage(m) {
    if (m.role === 'user') {
      const b = addBubble('user');
      b.textContent = m.content;
      return;
    }
    if (m.role === 'sage') {
      const b = addBubble('sage', m.mood);
      b.textContent = m.content;
      b.classList.remove('streaming');
      return;
    }
    if (m.role === 'judge') {
      // 回放时点评卡片内联进消息流（不是结算视图的 verdict-card 容器）
      try {
        const card = buildVerdictCard(JSON.parse(m.content));
        $('log').appendChild(card);
        scrollLog();
      } catch {
        addSys('（点评数据无法解析）');
      }
    }
  }

  function currentPersona() {
    return (
      state.personas.find((p) => p.key === (state.debate?.personaKey || state.pick.personaKey)) || {
        name: '先贤',
        glyph: '贤',
        accent: '#3f5a9e',
      }
    );
  }

  /* ── SSE 流 ── */
  async function streamSse(url, body, onEvent, resumeSeq, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (resumeSeq) headers['X-Resume-Seq'] = String(resumeSeq);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        const ev = /^event:\s*(.+)$/m.exec(p);
        const dt = /^data:\s*(.+)$/m.exec(p);
        if (!ev || !dt) continue;
        let data;
        try {
          data = JSON.parse(dt[1]);
        } catch {
          data = dt[1];
        }
        onEvent(ev[1].trim(), data);
      }
    }
  }

  /** 带「加载中 + 超时重试」的一个回合（开场或发言） */
  async function runTurn(url, body, resumeSeq) {
    const pending = addSys('正在唤醒先贤…（免费云冷启动可能需要二三十秒）', 'loading');
    let bubble = null;
    let gotFirst = false;
    let attempt = 0;
    let ctrl = new AbortController();
    let timer = setTimeout(() => {
      if (gotFirst) return;
      const r = document.createElement('button');
      r.className = 'retry';
      r.textContent = '还在加载？点此重试';
      r.onclick = () => ctrl.abort();
      pending.appendChild(r);
    }, FIRST_TOKEN_TIMEOUT);

    const onEvent = (name, data) => {
      if (name === 'start') {
        gotFirst = true;
        pending.remove();
        bubble = addBubble('sage', data.mood);
        return;
      }
      if (name === 'delta') {
        if (!bubble) {
          gotFirst = true;
          pending.remove();
          bubble = addBubble('sage');
        }
        // 续传 / 重试（含短文本重写）时整段替换，避免两轮输出拼接
        bubble.textContent = data.resume || data.replaced ? data.delta : bubble.textContent + data.delta;
        scrollLog();
        return;
      }
      if (name === 'done') {
        if (bubble) {
          bubble.textContent = data.fullText;
          bubble.classList.remove('streaming');
        }
        state.debate.seq = data.seq;
        if (data.short) addSys('（先贤此番言辞简短）');
        return;
      }
      if (name === 'digest') {
        addSys('（上下文已压缩）');
        return;
      }
      if (name === 'guard') {
        addSys('（人设守护：' + data.action + (data.reason ? ' · ' + data.reason : '') + '）');
        return;
      }
      if (name === 'round_end') {
        state.debate.round = data.round;
        updateRoundsPill();
        if (data.nextTurn === 'judge') {
          addSys('回合用尽，可请求裁判点评');
          $('judge').hidden = false;
        }
        return;
      }
      if (name === 'error') throw new Error(data.code || 'ERROR');
    };

    while (true) {
      try {
        await streamSse(url, body, onEvent, resumeSeq, ctrl.signal);
        clearTimeout(timer);
        pending.remove();
        return;
      } catch (e) {
        clearTimeout(timer);
        if (attempt++ >= MAX_RETRY) {
          pending.textContent = '连接失败：' + e.message + '（可退出后从历史重进）';
          throw e;
        }
        pending.textContent = `连接中断，正在重试（${attempt}/${MAX_RETRY}）…`;
        ctrl = new AbortController();
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  }

  /* ── 辩论室：流程 ── */
  function updateRoundsPill() {
    const d = state.debate;
    if (d) $('dh-rounds').textContent = `${Math.min(d.round || 1, d.maxRounds)}/${d.maxRounds}`;
  }

  function enterDebateView() {
    const p = currentPersona();
    const t = state.topics.find((x) => x.id === state.debate.topicId);
    $('dh-name').textContent = p.name;
    $('dh-topic').textContent = state.debate.topicTitle || (t ? t.title : '');
    $('dh-rounds').textContent = state.debate.demo ? '试玩' : `1/${state.debate.maxRounds}`;
    $('judge').hidden = true;
    $('log').innerHTML = '';
    setDemoChrome(!!state.debate.demo);
    showView('debate');
  }

  async function beginDebate() {
    if (state.mode === 'demo') return beginDemo();
    if (state.busy) return;
    const { personaKey, topicId, stance, maxRounds } = state.pick;
    if (!personaKey || !topicId) return;
    state.busy = true;
    syncBeginBtn();
    try {
      const res = await fetch(BASE + '/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaKey, topicId, userStance: stance, maxRounds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '建局失败');
      const persona = state.personas.find((p) => p.key === personaKey);
      const topic = state.topics.find((t) => t.id === topicId);
      setAccent(persona);
      state.debate = {
        id: data.debateId,
        personaKey,
        topicId,
        maxRounds,
        round: 1,
        status: 'opening',
        seq: 0,
      };
      state.verdict = null;
      store.add({
        debateId: data.debateId,
        personaKey,
        personaName: persona.name,
        glyph: persona.glyph,
        accent: persona.accent,
        topicId,
        topicTitle: topic.title,
        maxRounds,
        status: 'ongoing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        verdict: null,
      });
      enterDebateView();
      await runTurn(BASE + '/api/debate/' + data.debateId + '/opening', {}, 1);
      const fresh = await api('/api/debate/' + data.debateId);
      if (fresh) state.debate.round = fresh.round;
      updateRoundsPill();
      setComposerEnabled(true);
    } catch (e) {
      addSys('开局失败：' + e.message);
    } finally {
      state.busy = false;
      syncBeginBtn();
    }
  }

  /* ── 试玩模式：本地剧本，零 API 消耗 ── */
  /** 拆解 label 的「[动作/情绪]」舞台提示与台词正文 */
  function splitStage(label) {
    const m = /^\[(.+?)\]\s*([\s\S]+)$/.exec(label);
    return m ? { stage: m[1], text: m[2] } : { stage: '', text: label };
  }

  /** 舞台提示（斜体小字）+ 台词，塞进气泡或选项按钮 */
  function appendStaged(box, label) {
    const { stage, text } = splitStage(label);
    if (stage) {
      const i = document.createElement('i');
      i.className = 'stage';
      i.textContent = stage;
      box.appendChild(i);
    }
    const s = document.createElement('span');
    s.textContent = text;
    box.appendChild(s);
  }

  async function loadDemoScript(key) {
    try {
      const r = await fetch(BASE + '/demo-dialogues.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const s = data && data.scripts && data.scripts[key];
      if (!s) throw new Error('无此先贤的剧本');
      return s;
    } catch {
      return DEMO_FALLBACK.scripts[key]; // file:// / 断网 / JSON 损坏：内联兜底
    }
  }

  /** 一条先贤发言：1.5s 思考中动画 → 逐字流式（模拟真实 SSE 节奏） */
  function playDemoLine(text) {
    return new Promise((resolve) => {
      const think = addBubble('sage');
      think.classList.add('think');
      think.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      scrollLog();
      setTimeout(() => {
        think.remove();
        const b = addBubble('sage');
        b.classList.add('streaming');
        let i = 0;
        const timer = setInterval(() => {
          i += 1;
          b.textContent = text.slice(0, i);
          scrollLog();
          if (i >= text.length) {
            clearInterval(timer);
            b.classList.remove('streaming');
            resolve();
          }
        }, DEMO_TYPE_MS);
      }, DEMO_THINK_MS);
    });
  }

  function renderDemoOptions(roundIdx) {
    const box = $('demo-options');
    box.innerHTML = '';
    if (roundIdx === null) return;
    const round = state.demoScript.rounds[roundIdx];
    if (!round) return;
    for (const opt of round.options) {
      const b = document.createElement('button');
      b.className = 'opt-btn';
      b.type = 'button';
      appendStaged(b, opt.label);
      b.onclick = () => onDemoOption(roundIdx, opt.id);
      box.appendChild(b);
    }
  }

  async function onDemoOption(roundIdx, optId) {
    if (state.demoBusy) return;
    const script = state.demoScript;
    const round = script.rounds[roundIdx];
    const opt = round && round.options.find((o) => o.id === optId);
    if (!opt) return;
    state.demoBusy = true;
    renderDemoOptions(null); // 流式期间收起，防连点
    const mine = addBubble('user');
    appendStaged(mine, opt.label);
    scrollLog();
    await playDemoLine(opt.reply);
    const next = roundIdx + 1;
    if (next < script.rounds.length) {
      renderDemoOptions(next);
      state.demoBusy = false;
    } else {
      await playDemoLine(script.closing);
      state.demoBusy = false;
      showDemoEndCard();
    }
  }

  async function beginDemo() {
    if (state.busy) return;
    const personaKey = state.pick.personaKey;
    if (!personaKey) return;
    state.busy = true;
    syncBeginBtn();
    try {
      const script = await loadDemoScript(personaKey);
      const persona = state.personas.find((p) => p.key === personaKey);
      setAccent(persona);
      state.demoScript = script;
      state.debate = {
        id: 'demo-' + personaKey,
        personaKey,
        topicId: null,
        topicTitle: script.topicTitle,
        maxRounds: script.rounds.length,
        round: 1,
        status: 'opening',
        seq: 0,
        demo: true,
      };
      state.verdict = null;
      enterDebateView();
      await playDemoLine(script.opening);
      renderDemoOptions(0);
    } catch (e) {
      addSys('试玩剧本加载失败：' + e.message);
    } finally {
      state.busy = false;
      syncBeginBtn();
    }
  }

  /** 试玩收尾：分享卡金句取 closing 末句，结算视图换引流卡 */
  function showDemoEndCard() {
    const script = state.demoScript;
    const parts = script.closing.split(/[。！？]/).filter(Boolean);
    const quote = (parts.length ? parts[parts.length - 1] : script.closing).trim() + '。';
    state.verdict = null;
    showResult(quote);
    const vc = $('verdict-card');
    vc.innerHTML = '';
    const up = document.createElement('div');
    up.className = 'upgrade';
    const t = document.createElement('div');
    t.className = 'up-title';
    t.textContent = '试玩结束 · 这只是开场';
    const d = document.createElement('p');
    d.textContent = `深度体验模式里，${script.name}会真正回应你的每一句话：自由输入、实时生成、赛后裁判点评。`;
    const b = document.createElement('button');
    b.className = 'primary';
    b.type = 'button';
    b.textContent = '进入深度体验';
    b.onclick = () => {
      setMode('deep');
      showView('lobby');
    };
    up.append(t, d, b);
    vc.appendChild(up);
  }

  /** 试玩/深度两套底部 chrome：composer ↔ demo-options + 深度小字 */
  function setDemoChrome(on) {
    $('composer').hidden = on;
    $('demo-options').hidden = !on;
    $('deep-hint').hidden = on; // 「消耗演示额度，请轻拍」仅深度模式显示
    if (on) $('demo-options').innerHTML = '';
  }

  /* ── 模式切换 ── */
  function setMode(mode) {
    state.mode = mode;
    $('mode-pick').querySelectorAll('.mode-card').forEach((c) =>
      c.classList.toggle('on', c.dataset.mode === mode),
    );
    $('deep-picks').classList.toggle('locked', mode === 'demo');
    $('mode-hint').hidden = mode !== 'demo';
    $('btn-begin').textContent = mode === 'demo' ? '开始试玩' : '开始辩论';
  }

  function setComposerEnabled(on) {
    $('input').disabled = !on;
    $('send').disabled = !on;
    $('input').placeholder = on ? '说出你的观点…（≤500 字）' : '先贤思考中…';
  }

  async function sendTurn() {
    const text = $('input').value.trim();
    if (!text || state.busy || !state.debate) return;
    state.busy = true;
    setComposerEnabled(false);
    const mine = addBubble('user');
    mine.textContent = text;
    $('input').value = '';
    autoGrow($('input'));
    try {
      await runTurn(BASE + '/api/debate/' + state.debate.id + '/turn', { text }, state.debate.seq + 1);
      store.update(state.debate.id, { updatedAt: Date.now() });
    } catch {
      /* runTurn 已提示 */
    } finally {
      state.busy = false;
      setComposerEnabled(true);
    }
  }

  async function requestJudge() {
    if (state.busy || !state.debate) return;
    state.busy = true;
    $('judge').disabled = true;
    const pending = addSys('裁判正在通读对局…', 'loading');
    try {
      let verdict = null;
      await streamSse(
        BASE + '/api/debate/' + state.debate.id + '/judge',
        {},
        (name, data) => {
          if (name === 'judge_done') {
            verdict = data.verdict;
            return;
          }
          if (name === 'error') throw new Error(data.code || 'ERROR');
        },
        undefined,
        undefined,
      );
      pending.remove();
      if (!verdict) throw new Error('点评为空');
      state.verdict = verdict;
      store.update(state.debate.id, { status: 'done', verdict, updatedAt: Date.now() });
      showResult();
    } catch (e) {
      pending.textContent = '点评失败：' + e.message + '，可重试';
    } finally {
      state.busy = false;
      $('judge').disabled = false;
    }
  }

  /* ── 历史恢复 ── */
  async function resumeDebate(h) {
    const d = await api('/api/debate/' + h.debateId);
    if (!d) {
      // 后端内存态已丢（重启 / TTL 过期）：标记消散，允许移除
      h.dead = true;
      store.save(store.list());
      renderHistory();
      return;
    }
    const persona = state.personas.find((p) => p.key === h.personaKey);
    setAccent(persona || { accent: '#3f5a9e' });
    state.debate = {
      id: h.debateId,
      personaKey: h.personaKey,
      topicId: h.topicId,
      maxRounds: h.maxRounds,
      round: d.round,
      status: d.status,
      seq: d.seq,
    };
    enterDebateView();
    for (const m of d.messages || []) renderStoredMessage(m);
    if (d.status === 'done') {
      // 已终结的对局：回放 + 直达点评
      try {
        state.verdict = JSON.parse((d.messages || []).find((m) => m.role === 'judge')?.content || 'null');
      } catch {
        state.verdict = h.verdict || null;
      }
      addSys('此局已终结。');
      const go = document.createElement('button');
      go.className = 'primary';
      go.textContent = '查看点评与分享卡';
      go.style.alignSelf = 'center';
      go.onclick = showResult;
      $('log').appendChild(go);
      setComposerEnabled(false);
      $('judge').hidden = true;
    } else {
      updateRoundsPill();
      setComposerEnabled(true);
      $('input').focus();
    }
  }

  /* ── 结算 / 分享卡 ── */
  const SCORE_DIMS = [
    ['clarity', '论点清晰'],
    ['evidence', '论据'],
    ['logic', '逻辑'],
    ['rebuttal', '回应'],
    ['style', '风格'],
  ];

  /** 构建点评卡片节点（两处复用：结算视图 / 历史回放流内联） */
  function buildVerdictCard(v) {
    const card = document.createElement('div');
    card.className = 'verdict-card';

    const h3 = document.createElement('h3');
    h3.textContent = '裁判点评 · 不判胜负';
    card.appendChild(h3);

    const s = v.scores || {};
    const dims = SCORE_DIMS.filter(([k]) => s[k] != null);
    if (dims.length) {
      for (const [k, label] of dims) {
        const row = document.createElement('div');
        row.className = 'v-dim';
        const lb = document.createElement('label');
        lb.textContent = label;
        const bar = document.createElement('div');
        bar.className = 'v-bar';
        const fill = document.createElement('i');
        fill.style.width = Math.round((s[k] / 10) * 100) + '%';
        bar.appendChild(fill);
        const out = document.createElement('output');
        out.textContent = s[k];
        row.append(lb, bar, out);
        card.appendChild(row);
      }
    }

    const section = (title, arr) => {
      if (!arr || !arr.length) return;
      const h4 = document.createElement('h4');
      h4.textContent = title;
      const ul = document.createElement('ul');
      for (const item of arr) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      }
      card.append(h4, ul);
    };
    section('你的亮点', v.userHighlights);
    section('先贤的亮点', v.personaHighlights);
    section('给你的建议', v.suggestions);

    if (v.summary) {
      const p = document.createElement('p');
      p.style.margin = '10px 0 0';
      p.textContent = v.summary;
      card.appendChild(p);
    }
    if (v.followUpQuestion) {
      const q = document.createElement('p');
      q.style.cssText = 'margin:8px 0 0;color:#8a6d2f;font-size:12px';
      q.textContent = '先贤可能继续追问：' + v.followUpQuestion;
      card.appendChild(q);
    }
    return card;
  }

  function renderVerdict(v) {
    $('verdict-card').appendChild(buildVerdictCard(v));
  }

  /** Canvas 分享卡：750×1334 竖版，微信长按保存 / PC 下载 */
  function drawShareCard(quote) {
    const persona = currentPersona();
    const topic = state.topics.find((t) => t.id === state.debate?.topicId);
    // 试玩模式对局没有 topicId，用剧本自带标题
    const topicTitle = state.debate?.topicTitle || (topic ? topic.title : '无题');
    const cv = document.createElement('canvas');
    cv.width = 750;
    cv.height = 1334;
    const x = cv.getContext('2d');
    const accent = persona.accent || '#3f5a9e';

    // 背景与顶部色带
    x.fillStyle = '#f6f5f2';
    x.fillRect(0, 0, 750, 1334);
    const g = x.createLinearGradient(0, 0, 750, 0);
    g.addColorStop(0, accent);
    g.addColorStop(1, shade(accent, 24));
    x.fillStyle = g;
    x.fillRect(0, 0, 750, 240);

    x.textAlign = 'left';
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.font = '500 24px "PingFang SC","Microsoft YaHei",sans-serif';
    x.fillText('AGORA · 雅典广场', 48, 92);

    // glyph 圆章
    x.beginPath();
    x.arc(375, 168, 52, 0, Math.PI * 2);
    x.fillStyle = 'rgba(255,255,255,0.16)';
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.stroke();
    x.fillStyle = '#fff';
    x.font = '700 44px "PingFang SC","Microsoft YaHei",sans-serif';
    x.textAlign = 'center';
    x.fillText(persona.glyph, 375, 186);
    x.textAlign = 'left';

    // 标题
    x.fillStyle = '#23211c';
    x.font = '700 44px "PingFang SC","Microsoft YaHei",sans-serif';
    x.fillText(`我与${persona.name}论`, 48, 380);
    x.fillStyle = accent;
    x.font = '600 34px "PingFang SC","Microsoft YaHei",sans-serif';
    wrapText(x, `「${topicTitle}」`, 48, 440, 654, 48);

    // 分隔线
    x.strokeStyle = '#e4e0d6';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(48, 540);
    x.lineTo(702, 540);
    x.stroke();

    // 金句
    x.fillStyle = '#6b675c';
    x.font = '400 26px "PingFang SC","Microsoft YaHei",sans-serif';
    const quoteText = quote ? `“${quote}”` : '“未经审视的观点，不值得为之辩护。”';
    wrapText(x, quoteText, 48, 596, 654, 46);

    // 五维评分
    const v = state.verdict || {};
    const scores = v.scores || {};
    const dims = SCORE_DIMS.filter(([k]) => scores[k] != null);
    let y = 900;
    x.fillStyle = '#23211c';
    x.font = '600 26px "PingFang SC","Microsoft YaHei",sans-serif';
    x.fillText('裁判五维', 48, y);
    y += 30;
    for (const [k, label] of dims) {
      x.fillStyle = '#a39d8f';
      x.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
      x.fillText(label, 48, y + 14);
      x.fillStyle = '#efe9d8';
      roundRect(x, 150, y, 440, 16, 8);
      x.fill();
      x.fillStyle = '#8a6d2f';
      roundRect(x, 150, y, Math.max(16, (scores[k] / 10) * 440), 16, 8);
      x.fill();
      x.fillStyle = '#8a6d2f';
      x.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
      x.textAlign = 'right';
      x.fillText(String(scores[k]), 702, y + 16);
      x.textAlign = 'left';
      y += 44;
    }

    // 底部信息
    x.fillStyle = '#a39d8f';
    x.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
    const rounds = state.debate ? state.debate.maxRounds : 6;
    const d = new Date();
    x.fillText(`${rounds} 回合交锋 · ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, 48, 1216);
    x.fillStyle = '#8a6d2f';
    x.font = '500 24px "PingFang SC","Microsoft YaHei",sans-serif';
    x.fillText('不判胜负，只谈论证。', 48, 1262);
    return cv;
  }

  function showResult(quoteOverride) {
    const p = currentPersona();
    setAccent(p);
    $('verdict-card').innerHTML = '';
    if (state.verdict) renderVerdict(state.verdict);
    else {
      const t = document.createElement('div');
      t.className = 'verdict-card';
      t.textContent = '（此局没有点评数据）';
      $('verdict-card').appendChild(t);
    }
    // 取先贤最后一句作为金句（试玩模式由调用方显式传入 closing 末句）
    const quote = quoteOverride ?? lastSageQuote();
    const cv = drawShareCard(quote);
    cv.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      $('share-img').src = url;
      const a = $('btn-save');
      a.onclick = () => {
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = `agora-${state.debate?.personaKey || 'card'}.png`;
        dl.click();
      };
    }, 'image/png');
    showView('result');
    scrollLog();
  }

  function lastSageQuote() {
    const d = state.verdict;
    if (d && d.personaHighlights && d.personaHighlights.length) return d.personaHighlights[0];
    return null;
  }

  /* ── canvas 工具 ── */
  function wrapText(x, text, tx, ty, maxWidth, lineHeight) {
    let line = '';
    let y = ty;
    for (const ch of text) {
      if (x.measureText(line + ch).width > maxWidth && line) {
        x.fillText(line, tx, y);
        line = ch;
        y += lineHeight;
      } else {
        line += ch;
      }
    }
    if (line) x.fillText(line, tx, y);
    return y;
  }

  function roundRect(x, rx, ry, w, h, r) {
    x.beginPath();
    x.moveTo(rx + r, ry);
    x.arcTo(rx + w, ry, rx + w, ry + h, r);
    x.arcTo(rx + w, ry + h, rx, ry + h, r);
    x.arcTo(rx, ry + h, rx, ry, r);
    x.arcTo(rx, ry, rx + w, ry, r);
    x.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  /* ── 杂项 ── */
  async function api(path) {
    try {
      const res = await fetch(BASE + path);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  /* ── 事件绑定 ── */
  function bind() {
    $('mode-pick').querySelectorAll('.mode-card').forEach((c) => {
      c.onclick = () => setMode(c.dataset.mode);
    });

    document.querySelectorAll('.topic-tabs button').forEach((b) => {
      b.onclick = () => {
        state.topicCat = b.dataset.cat;
        document.querySelectorAll('.topic-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        renderTopics();
      };
    });

    $('stance-pick').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.pick.stance = b.dataset.v;
        $('stance-pick').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });

    $('rounds-pick').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.pick.maxRounds = Number(b.dataset.v);
        $('rounds-pick').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });

    $('btn-begin').onclick = beginDebate;
    $('send').onclick = sendTurn;
    $('judge').onclick = requestJudge;
    $('btn-again').onclick = () => beginDebate();
    $('btn-home').onclick = () => {
      renderHistory();
      showView('lobby');
    };
    $('btn-clear-history').onclick = () => {
      if (confirm('清空全部对局历史？（不影响服务器上的对局）')) {
        store.clear();
        renderHistory();
      }
    };
    $('btn-quit').onclick = () => {
      if (confirm('退出对局？服务端对局还会保留一段时间，可从历史继续。')) {
        state.debate = null;
        renderHistory();
        showView('lobby');
      }
    };

    const input = $('input');
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTurn();
      }
    });
  }

  /* ── 启动 ── */
  async function init() {
    bind();
    const [personas, topics] = await Promise.all([api('/api/personas'), api('/api/topics')]);
    if (!personas || !topics) {
      addSys('后端连接失败，请刷新重试');
      return;
    }
    state.personas = personas.items;
    state.topics = topics.items;
    state.pick.personaKey = state.personas[0]?.key ?? null;
    state.pick.topicId = state.topics[0]?.id ?? null;
    if (state.personas[0]) setAccent(state.personas[0]);
    renderPersonas();
    renderTopics();
    renderHistory();
    setMode(state.mode); // 同步大厅模式卡 / 锁定区 / 按钮文案
    syncBeginBtn();
    showView('lobby');
  }

  init();
})();
