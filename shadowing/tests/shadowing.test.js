// Headless regression tests for index.html's player logic.
//   node tests/shadowing.test.js
// Stubs just enough DOM/HTMLAudioElement to drive the real inline script with a fake clock.
const fs = require('fs'), path = require('path');

// Minimal DOM/audio stubs so the app's real logic can be driven headlessly.
const store = {};
class El {
  constructor(tag){ this.tag=tag; this.children=[]; this._cls=new Set(); this.style={}; this.dataset={};
    this.classList={ add:c=>this._cls.add(c), remove:c=>this._cls.delete(c),
      contains:c=>this._cls.has(c),
      toggle:(c,f)=>{ if(f===undefined) f=!this._cls.has(c); f?this._cls.add(c):this._cls.delete(c); return f; } };
    this.textContent=''; this.value=0; this.offsetHeight=120; }
  set className(v){ this._cls=new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className(){ return [...this._cls].join(' '); }
  set innerHTML(v){ this._html=v; if(v==='') this.children=[]; }
  get innerHTML(){ return this._html||''; }
  appendChild(c){ this.children.push(c); return c; }
  addEventListener(t,f){ (this._ev=this._ev||{})[t]=f; }
  scrollIntoView(){ this._scrolls=(this._scrolls||0)+1; }
  querySelectorAll(){ return []; }
  click(){ if(this.onclick) this.onclick({currentTarget:this, preventDefault(){}, stopPropagation(){}}); }
}
const byId = {};
for (const id of ['tabs','doc','progress','tCur','tDur','scrub','btnPlay','btnStop','btnBack','btnFwd',
                  'btnReplay','btnLoop','btnShadow','speeds','gaps','gapWrap','gapcue','gapText','gapBar','player','scriptSeg','gapDn','gapUp','gapVal',
                  'addOverlay','addPanel','addText','addUrl','addTitle','addVoice','addKey',
                  'addStatus','addProgress','addProgressWrap','addGo','addCancel','tabPaste','tabUrl','btnDel'])
  byId[id] = new El('div');

const segSimp=new El('button'), segTrad=new El('button');
segSimp.dataset.s='simp'; segTrad.dataset.s='trad';
byId['scriptSeg'].children=[segSimp,segTrad];
byId['scriptSeg'].querySelectorAll=()=>[segSimp,segTrad];
globalThis.__seg={simp:segSimp,trad:segTrad};
globalThis.document = {
  getElementById: id => byId[id],
  createElement: t => new El(t),
  querySelector: sel => (byId[sel] || (byId[sel] = new El(sel))),
  documentElement: { style: { setProperty(){} }, lang: 'zh-Hant' },
  addEventListener(){}, visibilityState:'visible'
};
globalThis.__win={};
globalThis.window = { addEventListener:(t,f)=>__win[t]=f, ResizeObserver:null, getSelection:()=>__sel };
globalThis.document = globalThis.document || {};
globalThis.indexedDB = { open: () => { const r = {}; setTimeout(()=>r.onerror && r.onerror(), 0); return r; } };
globalThis.confirm = () => false;
globalThis.__sel = { isCollapsed: true, toString: () => '' };
globalThis.getSelection = () => __sel;
globalThis.localStorage = { getItem:k=>store[k]||null, setItem:(k,v)=>store[k]=v };
let NOW = 0, timers = [];
globalThis.performance = { now: ()=>NOW };
globalThis.setTimeout = (f,ms)=>{ const t={f,at:NOW+ms,id:timers.length}; timers.push(t); return t.id; };
globalThis.clearTimeout = id => { const t=timers.find(x=>x.id===id); if(t) t.done=true; };
globalThis.requestAnimationFrame = ()=>0;
globalThis.cancelAnimationFrame = ()=>{};
globalThis.URL = { createObjectURL:()=>'blob:x', revokeObjectURL(){} };
globalThis.Blob = class{}; globalThis.Uint8Array = Uint8Array;
globalThis.atob = ()=>'';

const LOG = [];
class FakeAudio {
  constructor(){ this._t=0; this.paused=true; this.duration=NaN; this.playbackRate=1; }
  get currentTime(){ return this._t; }
  set currentTime(v){ this._t=v; LOG.push('seek '+v.toFixed(2)); if(this.onseeking) this.onseeking(); }
  set src(v){ this._t=0; this.paused=true; this.duration=160; if(this.onloadedmetadata) this.onloadedmetadata(); }
  play(){ this.paused=false; LOG.push('play@'+this._t.toFixed(2)); if(this.onplay) this.onplay(); return Promise.resolve(); }
  pause(){ if(!this.paused) LOG.push('pause@'+this._t.toFixed(2)); this.paused=true; if(this.onpause) this.onpause(); }
}
globalThis.Audio = FakeAudio;
globalThis.__LOG = LOG;
globalThis.__tick = (dtMs) => {          // advance wall clock + playhead together
  NOW += dtMs;
  const audio = globalThis.__app.audio;
  if(!audio.paused) audio._t += dtMs/1000 * audio.playbackRate;
  for(const t of timers) if(!t.done && t.at<=NOW){ t.done=true; t.f(); }
  if(!audio.paused && audio.ontimeupdate) audio.ontimeupdate();
};

// ---- load the real app script out of index.html ----
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'opencc.js'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
src += "\nglobalThis.__app = { get gapActive(){return gapActive}, get shadow(){return shadow}, get loop(){return loop},"
     + " get curSent(){return curSent}, get gapLen(){return gapLen}, get shSent(){return shSent}, get words(){return words},"
     + " get sentEls(){return sentEls}, get curW(){return curW}, get script(){return script}, get ai(){return ai},"
     + " get scrubbing(){return scrubbing}, get pendingLatch(){return pendingLatch}, get gapResume(){return gapResume},"
     + " get gapSecs(){return gapSecs}, setGap, isLookup, hoveringText,"
     + " convert, detectScript, buildTrie, convertWith, splitSentences, segWords, weigh,"
     + " get DATA(){return DATA},"
     + " sentBounds, findWord, audio, setCur, renderDoc, loadArticle, latchFrom };";
(0, eval)(src);


let fails = 0;
const ok = (name, cond, extra='') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   ' + extra));
  if(!cond) fails++;
};

console.log('\n-- highlight / script toggle / shadowing drill --');
{
// fresh slate: suites share one process
if(__app.shadow) document.getElementById('btnShadow').click();
if(__app.loop)   document.getElementById('btnLoop').click();
__app.loadArticle(0,0);

const A=__app, au=A.audio;

// ---- BUG 1: script toggle must not swallow the highlight ----
au.currentTime = 10.0; au.play();
__tick(0);
const sentBefore = A.curSent, wBefore = A.curW;
ok('highlight active before toggle', sentBefore>=0 && wBefore>=0, 'sent='+sentBefore);
// simulate the 简体 click through the real handler
const keepT=au.currentTime;
A.renderDoc();
ok('renderDoc resets curW', A.curW===-1, 'curW='+A.curW);
const i=A.findWord(keepT); A.setCur(i);
ok('highlight restored immediately after re-render', A.curSent>=0 && A.curW===i && A.sentEls[A.curSent]._cls.has('active'),
   'curSent='+A.curSent+' curW='+A.curW+' i='+i);

// ---- shadow drill: gap after each sentence, then advance ----
A.loadArticle(0,0);
document.getElementById('btnShadow').click();
ok('shadow mode on', A.shadow===true);
const b0 = A.sentBounds(0);           // title sentence
au.currentTime = b0[0]; au.play();
__LOG.length=0;
for(let k=0;k<40 && !A.gapActive;k++) __tick(100);
ok('gap starts at the sentence boundary', A.gapActive===true && Math.abs(au.currentTime-b0[1])<0.01,
   'gapActive='+A.gapActive+' t='+au.currentTime+' want '+b0[1]);
ok('audio is paused during the gap', au.paused===true);
ok('gap length is the fixed seconds setting, not a multiple of the sentence',
   A.gapLen===A.gapSecs && A.gapLen!==(b0[1]-b0[0]),
   'gapLen='+A.gapLen+' gapSecs='+A.gapSecs+' sentDur='+(b0[1]-b0[0]));
ok('play icon shows PAUSE while waiting', document.getElementById('btnPlay').innerHTML.includes('rect'));
ok('finished sentence is flagged for repeating', A.sentEls[0]._cls.has('shadowing'));
__tick(A.gapLen*1000+50);
ok('resumes into the NEXT sentence after the gap', !au.paused && Math.abs(au.currentTime-b0[1])<0.3,
   't='+au.currentTime);
ok('gap cleared on resume', A.gapActive===false && !A.sentEls[0]._cls.has('shadowing'));

// second sentence also gets a gap (i.e. it repeats, not a one-off)
const b1 = A.sentBounds(A.findWord(b0[1]+0.01));
for(let k=0;k<200 && !A.gapActive;k++) __tick(100);
ok('gap fires again on the next sentence', A.gapActive===true && Math.abs(au.currentTime-b1[1])<0.01,
   't='+au.currentTime+' want '+b1[1]);

// ---- shadow + loop: repeat the SAME sentence with a gap between reps ----
document.getElementById('btnPlay').click();   // cancel the gap, resume
document.getElementById('btnLoop').click();
ok('loop on', A.loop===true);
const lb = A.sentBounds(A.findWord(au.currentTime));
for(let k=0;k<300 && !A.gapActive;k++) __tick(100);
ok('loop+shadow gaps at sentence end', A.gapActive===true);
__tick(A.gapLen*1000+50);
ok('loop+shadow rewinds to the SAME sentence', Math.abs(au.currentTime-lb[0])<0.01,
   't='+au.currentTime+' want '+lb[0]);

// ---- tapping play during a gap skips the wait ----
for(let k=0;k<300 && !A.gapActive;k++) __tick(100);
ok('in a gap again', A.gapActive===true);
document.getElementById('btnPlay').click();
ok('play during gap cancels it and resumes', A.gapActive===false && !au.paused);

// ---- persistence ----
au.currentTime = 42.5; au.play();
__tick(0);
const saved = JSON.parse(localStorage.getItem('shadowing.v1'));
ok('state persisted', saved && saved.ai===0 && Math.abs(saved.t-42.5)<1 && saved.shadow===true && saved.loop===true,
   JSON.stringify(saved));
}
console.log('\n-- script handler, scrubbing, loop latching --');
{
// fresh slate: suites share one process
if(__app.shadow) document.getElementById('btnShadow').click();
if(__app.loop)   document.getElementById('btnLoop').click();
__app.loadArticle(0,0);

const A=__app, au=A.audio;

// --- BUG 1 via the real 简体/繁體 handler ---
A.loadArticle(0,0);
au.currentTime=10.0; au.play(); __tick(0);
const before=A.curSent;
ok('highlighted before toggle', before>=0 && A.curW>=0);
__seg.simp.click();                                   // real handler
ok('script switched to simplified', A.script==='simp');
ok('word highlight survives the script toggle',
   A.curW>=0 && A.words[A.curW].el._cls.has('cur'), 'curW='+A.curW);
ok('sentence band survives the script toggle',
   A.curSent>=0 && A.sentEls[A.curSent]._cls.has('active'), 'curSent='+A.curSent);
ok('same sentence as before', A.curSent===before, A.curSent+' vs '+before);
__seg.trad.click();

// --- BUG 4: pointerup off the slider clears scrubbing ---
document.getElementById('scrub')._ev.pointerdown();
ok('scrubbing set on pointerdown', A.scrubbing===true);
__win.pointerup();                                     // released anywhere on the page
ok('scrubbing cleared by a window-level pointerup', A.scrubbing===false);

// --- jumping before the first word still latches the loop ---
document.getElementById('btnLoop').click();
ok('loop on', A.loop===true);
au.currentTime=1.0;
A.latchFrom(-99);
ok('latch clamps to word 0 instead of -1', A.pendingLatch===0, 'pendingLatch='+A.pendingLatch);

// --- switching articles keeps loop/shadow as sticky modes and re-latches ---
A.loadArticle(1,0);
ok('loop still on after article switch', A.loop===true);
ok('loop re-latched on the new article', A.pendingLatch===0, 'pendingLatch='+A.pendingLatch);
au.play(); const lb=A.sentBounds(0);
for(let k=0;k<400 && au.currentTime<lb[1]+0.2;k++) __tick(100);
ok('loop actually wraps without needing a tap first', au.currentTime < lb[1]+0.3, 't='+au.currentTime);
}
console.log('\n-- end-of-article behaviour --');
{
// fresh slate: suites share one process
if(__app.shadow) document.getElementById('btnShadow').click();
if(__app.loop)   document.getElementById('btnLoop').click();
__app.loadArticle(0,0);

const A=__app, au=A.audio;

A.loadArticle(0,0);
if(!A.shadow) document.getElementById('btnShadow').click();
if(A.loop) document.getElementById('btnLoop').click();
ok('shadow on, loop off', A.shadow && !A.loop);

const lastIdx = A.sentEls.length-1;
const lastB = A.sentBounds(A.words.length-1);
ok('audio has trailing silence past the last word', au.duration > lastB[1]+0.5,
   'dur='+au.duration+' lastWordEnd='+lastB[1]);

au.currentTime = lastB[1]-1.0; au.play();
for(let k=0;k<60 && !A.gapActive;k++) __tick(100);
ok('gap fires on the final sentence', A.gapActive===true, 't='+au.currentTime);
ok('final sentence resumes to nowhere (stop, not repeat)', A.gapResume===-1, 'gapResume='+A.gapResume);
__tick(A.gapLen*1000+100);
ok('stays paused after the final gap', au.paused===true && A.gapActive===false);

let gaps=0;
for(let k=0;k<100;k++){ __tick(100); if(A.gapActive) gaps++; }
ok('does NOT re-trigger forever on the last sentence', gaps===0 && au.paused, 'extra gaps='+gaps);

// non-final sentences still advance
A.loadArticle(0,0);
au.currentTime=A.sentBounds(0)[0]; au.play();
for(let k=0;k<60 && !A.gapActive;k++) __tick(100);
ok('non-final sentence still resumes forward', A.gapResume>0, 'gapResume='+A.gapResume);


A.loadArticle(0,0);
au.currentTime = A.sentBounds(A.words.length-1)[1] + 0.5;   // park in the trailing silence
au.play();
let g2=0; for(let k=0;k<60;k++){ __tick(100); if(A.gapActive) g2++; }
ok('play from trailing silence does not insta-gap', g2===0, 'gaps='+g2);

}

console.log('\n-- pause-length stepper --');
{
const A=__app;
A.setGap(3);
ok('shows seconds, one decimal', document.getElementById('gapVal').textContent==='3.0s',
   document.getElementById('gapVal').textContent);
A.setGap(3.5); ok('steps up by 0.5s', A.gapSecs===3.5 && document.getElementById('gapVal').textContent==='3.5s');
A.setGap(0.1); ok('clamps at the low end', A.gapSecs===0.5, 'gapSecs='+A.gapSecs);
ok('minus disabled at the floor', document.getElementById('gapDn').disabled===true);
A.setGap(99); ok('clamps at the high end', A.gapSecs===15, 'gapSecs='+A.gapSecs);
ok('plus disabled at the ceiling', document.getElementById('gapUp').disabled===true);
A.setGap(2.3); ok('snaps to the 0.5s grid', A.gapSecs===2.5, 'gapSecs='+A.gapSecs);
ok('persisted as seconds', JSON.parse(localStorage.getItem('shadowing.v1')).gapSecs===2.5);

// the gap actually honours the setting, whatever the sentence length
A.setGap(4);
if(!A.shadow) document.getElementById('btnShadow').click();
if(A.loop) document.getElementById('btnLoop').click();
A.loadArticle(0,0);
const b=A.sentBounds(0);
A.audio.currentTime=b[0]; A.audio.play();
for(let k=0;k<80 && !A.gapActive;k++) __tick(100);
ok('a short sentence still gets the full 4.0s', A.gapActive && A.gapLen===4, 'gapLen='+A.gapLen);
let waited=0;
while(A.gapActive && waited<6000){ __tick(100); waited+=100; }
ok('resumes after ~4s, not after the sentence duration', Math.abs(waited-4000)<=200, 'waited='+waited+'ms');
}

console.log('\n-- hover-dictionary friendliness --');
{
const A=__app, au=A.audio;
if(A.shadow) document.getElementById('btnShadow').click();
if(A.loop)   document.getElementById('btnLoop').click();
A.loadArticle(0,0);

// a plain click still seeks
const word = A.words[6], plain = {stopPropagation(){}};
au.currentTime = 0; au.pause();
word.el.onclick(plain);
ok('plain click still seeks to the word', Math.abs(au.currentTime-word.s)<1e-9,
   't='+au.currentTime+' want '+word.s);

// a modifier click (how Yomitan scans) must not
au.currentTime = 0;
['shiftKey','altKey','ctrlKey','metaKey'].forEach(mod=>{
  const ev = {stopPropagation(){}}; ev[mod]=true;
  au.currentTime = 0;
  word.el.onclick(ev);
  ok(mod+' click does not hijack the audio', au.currentTime===0, 't='+au.currentTime);
});

// clicking with text selected (you highlighted a phrase to look up) must not either
__sel = { isCollapsed:false, toString:()=>'\u96dc\u8a8c' };
au.currentTime = 0;
word.el.onclick({stopPropagation(){}});
ok('click with an active selection does not hijack the audio', au.currentTime===0, 't='+au.currentTime);
A.sentEls[3].onclick({});
ok('sentence click with a selection does not hijack either', au.currentTime===0, 't='+au.currentTime);
__sel = { isCollapsed:true, toString:()=>'' };
au.currentTime = 0;
A.sentEls[3].onclick({});
ok('sentence click still seeks once the selection is gone', au.currentTime>0, 't='+au.currentTime);

// auto-scroll yields while the mouse is over the text
const doc = document.getElementById('doc');
A.loadArticle(0,0);
au.currentTime = A.sentBounds(0)[0]; au.play();
doc._ev.pointermove({pointerType:'mouse'});
ok('hover detected', A.hoveringText()===true);
let before = A.sentEls.reduce((n,el)=>n+(el._scrolls||0),0);
for(let k=0;k<60;k++) __tick(200);
let after = A.sentEls.reduce((n,el)=>n+(el._scrolls||0),0);
ok('page does NOT auto-scroll while hovering a word', after===before, 'scrolls='+(after-before));

// ...and resumes once the pointer leaves
doc._ev.pointerleave({pointerType:'mouse'});
ok('hover cleared on pointerleave', A.hoveringText()===false);
before = after;
for(let k=0;k<60;k++) __tick(200);
after = A.sentEls.reduce((n,el)=>n+(el._scrolls||0),0);
ok('auto-scroll resumes after the pointer leaves', after>before, 'scrolls='+(after-before));

// ...and also resumes if a cursor is parked and forgotten
doc._ev.pointermove({pointerType:'mouse'});
ok('hover set again', A.hoveringText()===true);
__tick(10500);
ok('a cursor idle >10s stops suppressing scroll', A.hoveringText()===false);

// touch taps must not disable scrolling forever (pointerleave may never fire)
doc._ev.pointermove({pointerType:'touch'});
ok('touch pointers are ignored for hover suppression', A.hoveringText()===false);

// Shift-modified keys pass through to the dictionary
const seen = [];
const realShadow = A.shadow;
document.dispatchEvent = null;
ok('isLookup treats a bare click as not-a-lookup', A.isLookup({})===false);
ok('isLookup catches shift', A.isLookup({shiftKey:true})===true);
}


console.log('\n-- OpenCC 简 <-> 繁 --');
{
const A = __app;
const s2t = [
  ['头发','頭髮',   'not 頭發 — phrase table disambiguates 发'],
  ['干净','乾淨',   'not 干淨'],
  ['后面','後面',   '后 as "behind"'],
  ['皇后','皇后',   '后 as "empress" must NOT become 後'],
  ['里面','裡面',   'TW variant, not 裏面'],
  ['松树','松樹',   '松 must NOT become 鬆'],
  ['面条','麵條',   '面 as "noodle"'],
  ['表面','表面',   '面 as "surface" stays'],
  ['计划','計劃'],
  ['布局','佈局'],
  ['他说他会来','他說他會來'],
];
for(const [inp,want,why] of s2t)
  ok('s2t ' + inp + ' -> ' + want + (why? '  (' + why + ')' : ''),
     A.convert(inp,'s2t') === want, 'got ' + A.convert(inp,'s2t'));

const t2s = [['頭髮','头发'],['乾淨','干净'],['裡面','里面'],['麵條','面条'],['雜誌','杂志'],['這期雜誌的主題','这期杂志的主题']];
for(const [inp,want] of t2s)
  ok('t2s ' + inp + ' -> ' + want, A.convert(inp,'t2s') === want, 'got ' + A.convert(inp,'t2s'));

ok('longest match beats character-by-character',
   A.convert('头发','s2t') === '頭髮' && A.convert('发','s2t') === '發',
   '发 alone -> ' + A.convert('发','s2t'));
ok('text with no convertible characters is returned unchanged',
   A.convert('ABC 123 ！','s2t') === 'ABC 123 ！');
ok('empty string is safe', A.convert('','s2t') === '' && A.convert('','t2s') === '');

ok('detect simplified', A.detectScript('这是简体中文，编辑部收到了读者来信') === 'simp');
ok('detect traditional', A.detectScript('這是繁體中文，編輯部收到了讀者來信') === 'trad');
ok('detect defaults to simp on script-neutral text', A.detectScript('ABC 123') === 'simp');

// Strongest check available: compare against the hand-authored pairs in the bundled
// articles. They were not produced by OpenCC and prefer some archaic variants
// (爲 裏 喫 纔), so exact equality is the wrong bar — agreement plus a closed set of
// known variant differences is.
const ALLOWED_VARIANTS = new Set(['為/爲','吃/喫','裡/裏','才/纔','峰/峯','著/着']);
let checked = 0, mismatch = 0, unexpected = [];
for(const art of A.DATA){
  for(const t of [...art.intro, ...art.paras.flat(2)]){
    const [simp, trad] = t;
    if(simp === trad) continue;
    checked++;
    const got = A.convert(simp, 's2t');
    if(got === trad) continue;
    mismatch++;
    if(got.length !== trad.length){ unexpected.push(simp+' -> '+got+' vs '+trad); continue; }
    for(let i=0;i<got.length;i++)
      if(got[i] !== trad[i] && !ALLOWED_VARIANTS.has(got[i]+'/'+trad[i]))
        unexpected.push(simp+': '+got[i]+'/'+trad[i]);
  }
}
const agree = (1 - mismatch/checked) * 100;
ok('agrees with the hand-made demo pairs (' + checked + ' tokens, ' + agree.toFixed(1) + '%)',
   agree >= 95, mismatch + ' mismatches');
ok('every divergence is a known variant preference, not a conversion error',
   unexpected.length === 0, unexpected.slice(0,5).join(' | '));
ok('our variant choices are the modern standard forms',
   A.convert('因为','s2t') === '因為' && A.convert('吃饭','s2t') === '吃飯' && A.convert('才','s2t') === '才',
   [A.convert('因为','s2t'), A.convert('吃饭','s2t'), A.convert('才','s2t')].join(' '));
}

console.log('\n-- segmentation --');
{
const A = __app;
ok('splits on 。！？',
   JSON.stringify(A.splitSentences('回到城市。收到了信！是故事？')) === JSON.stringify(['回到城市。','收到了信！','是故事？']),
   JSON.stringify(A.splitSentences('回到城市。收到了信！是故事？')));
ok('keeps a closing quote with its sentence',
   JSON.stringify(A.splitSentences('他說「好。」下一句。')) === JSON.stringify(['他說「好。」','下一句。']),
   JSON.stringify(A.splitSentences('他說「好。」下一句。')));
ok('trailing text with no terminator still becomes a sentence',
   JSON.stringify(A.splitSentences('沒有句號')) === JSON.stringify(['沒有句號']));
ok('words segment like the hand-made data',
   JSON.stringify(A.segWords('這期雜誌的主題是回到二三線城市。'))
     === JSON.stringify(['這','期','雜誌','的','主題','是','回到','二','三線','城市。']),
   JSON.stringify(A.segWords('這期雜誌的主題是回到二三線城市。')));
ok('punctuation attaches to the preceding word, never stands alone',
   A.segWords('好。').length === 1 && A.segWords('好。')[0] === '好。');
ok('punctuation carries less duration than a character', A.weigh('。') < A.weigh('的'));
ok('a token never gets zero weight', A.weigh('。') > 0 && A.weigh('') > 0);
}

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall green');
process.exit(fails ? 1 : 0);
