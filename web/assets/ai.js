/* ai.js — AI Settings + grounded AI Assistant chat. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,route=A.route,nav=A.nav;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card;

var CFG_KEY='ri_ai_config';
function getCfg(){try{return JSON.parse(localStorage.getItem(CFG_KEY))||{};}catch(e){return{};}}
function setCfg(c){localStorage.setItem(CFG_KEY,JSON.stringify(c));}
function aiReady(){var c=getCfg();return!!(c.provider&&c.model);}

var PROVIDERS=[
  {id:'openai',label:'OpenAI',base:'https://api.openai.com/v1',needsKey:true},
  {id:'openrouter',label:'OpenRouter',base:'https://openrouter.ai/api/v1',needsKey:true},
  {id:'groq',label:'Groq',base:'https://api.groq.com/openai/v1',needsKey:true},
  {id:'together',label:'Together AI',base:'https://api.together.xyz/v1',needsKey:true},
  {id:'deepseek',label:'DeepSeek',base:'https://api.deepseek.com/v1',needsKey:true},
  {id:'mistral',label:'Mistral',base:'https://api.mistral.ai/v1',needsKey:true},
  {id:'anthropic',label:'Anthropic (Claude)',base:'https://api.anthropic.com',needsKey:true},
  {id:'gemini',label:'Google Gemini',base:'https://generativelanguage.googleapis.com',needsKey:true},
  {id:'ollama',label:'Ollama (local)',base:'http://localhost:11434',needsKey:false},
  {id:'lmstudio',label:'LM Studio (local)',base:'http://localhost:1234/v1',needsKey:false},
  {id:'custom',label:'Custom (OpenAI-compatible)',base:'',needsKey:false}
];

// ============ SETTINGS ============
route('settings',function(content){
  var v=view(pt('AI Settings','AI is optional. Configure any provider to enable grounded explanations and repository Q&A. Keys are kept in your browser and sent to the local server only to relay each request to your chosen provider.'));
  var cfg=getCfg();
  var c=card('Provider configuration',null);
  var provSel=h('select');PROVIDERS.forEach(function(p){provSel.appendChild(h('option',{value:p.id,text:p.label,selected:cfg.provider===p.id?'selected':null}));});
  var baseI=h('input',{value:cfg.baseUrl||''});
  var keyI=h('input',{type:'password',value:cfg.apiKey||'',placeholder:'API key (leave blank for local providers)'});
  var modelSel=h('select');var modelI=h('input',{value:cfg.model||'',placeholder:'model name'});
  var tempI=h('input',{type:'number',step:'0.1',min:'0',max:'2',value:cfg.temperature!=null?cfg.temperature:0.2});
  var maxI=h('input',{type:'number',step:'128',min:'128',value:cfg.maxTokens||1024});
  var streamI=h('input',{type:'checkbox'});streamI.checked=cfg.stream!==false;
  var status=h('div',{class:'mini',style:'margin-top:6px'});

  function fieldsForProvider(){
    var p=PROVIDERS.find(function(x){return x.id===provSel.value;});
    if(p&&!baseI.value)baseI.value=p.base;
  }
  provSel.addEventListener('change',function(){var p=PROVIDERS.find(function(x){return x.id===provSel.value;});baseI.value=p?p.base:'';modelSel.innerHTML='';});
  fieldsForProvider();

  c.appendChild(field('Provider',provSel));
  c.appendChild(field('Base URL (for OpenAI-compatible / local endpoints)',baseI));
  c.appendChild(field('API Key',keyI));
  // model row with discover
  var modelWrap=h('div');
  var mrow=h('div',{style:'display:flex;gap:8px'});
  modelSel.style.flex='1';modelI.style.flex='1';modelSel.style.display='none';
  var discBtn=h('button',{class:'btn ghost sm',text:'Discover models'});
  mrow.appendChild(modelSel);mrow.appendChild(modelI);mrow.appendChild(discBtn);
  modelWrap.appendChild(mrow);
  c.appendChild(field('Model',modelWrap));
  var two=h('div',{class:'two'});two.appendChild(field('Temperature',tempI));two.appendChild(field('Max tokens',maxI));c.appendChild(two);
  c.appendChild(field('Stream responses',streamI));
  c.appendChild(status);

  function collect(){return{provider:provSel.value,baseUrl:baseI.value.trim(),apiKey:keyI.value,model:(modelSel.style.display!=='none'&&modelSel.value)?modelSel.value:modelI.value.trim(),temperature:parseFloat(tempI.value),maxTokens:parseInt(maxI.value,10),stream:streamI.checked};}

  discBtn.addEventListener('click',function(){
    status.textContent='Discovering models...';
    fetch('/api/ai/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:collect()})})
      .then(function(r){return r.json();}).then(function(res){
        if(res.ok&&res.models.length){
          modelSel.innerHTML='';res.models.forEach(function(m){modelSel.appendChild(h('option',{value:m,text:m,selected:cfg.model===m?'selected':null}));});
          modelSel.style.display='';modelI.style.display='none';
          status.innerHTML='<span class="status-dot ok"></span>Found '+res.models.length+' models.';
        }else{
          modelSel.style.display='none';modelI.style.display='';
          status.innerHTML='<span class="status-dot err"></span>Discovery unavailable ('+esc(res.error||'none returned')+'). Enter a model name manually.';
        }
      }).catch(function(e){status.innerHTML='<span class="status-dot err"></span>'+esc(e.message);});
  });

  var saveBtn=h('button',{class:'btn sm',text:'Save configuration'});
  saveBtn.addEventListener('click',function(){var nc=collect();if(!nc.model){status.innerHTML='<span class="status-dot err"></span>Please set a model.';return;}setCfg(nc);status.innerHTML='<span class="status-dot ok"></span>Saved. AI Assistant is enabled.';buildNavCounts();});
  var clearBtn=h('button',{class:'btn ghost sm',text:'Clear',style:'margin-left:8px'});
  clearBtn.addEventListener('click',function(){localStorage.removeItem(CFG_KEY);status.innerHTML='<span class="status-dot off"></span>Cleared. AI is disabled; the rest of the platform works without it.';});
  c.appendChild(el('<hr class="sep">'));var brow=h('div');brow.appendChild(saveBtn);brow.appendChild(clearBtn);c.appendChild(brow);
  v.appendChild(c);

  v.appendChild(el('<div class="callout"><b>AI is never required.</b> Every dashboard, explorer, graph, flow, and search works fully offline without any AI configuration. When configured, the assistant answers strictly from the static-analysis index and cites file:line references; if the evidence is missing it will say so rather than guess.</div>'));
  content.innerHTML='';content.appendChild(v);
});
function field(label,input){var f=h('div',{class:'field'});f.appendChild(h('label',{text:label}));f.appendChild(input);return f;}
function buildNavCounts(){}

// ============ AI ASSISTANT (chat) ============
var history=[];
route('ai',function(content){
  var v=view([]);
  v.appendChild(el('<h1 class="pt">AI Assistant</h1>'));
  if(!aiReady()){
    v.appendChild(el('<div class="pd">Ask questions about this repository. Answers are grounded in the static-analysis index and cite exact locations.</div>'));
    v.appendChild(el('<div class="ai-off-note"><div style="font-size:34px;margin-bottom:10px">&#9211;</div><div style="font-size:15px;margin-bottom:6px">AI is not configured yet.</div><div class="mini" style="margin-bottom:16px">The platform is fully usable without AI. To enable Q&amp;A, add any provider.</div><span class="btn sm" onclick="RINAV(\'settings\')">Open AI Settings</span></div>'));
    content.innerHTML='';content.appendChild(v);return;
  }
  var cfg=getCfg();
  v.appendChild(el('<div class="pd">Grounded in static analysis of <span class="mono">'+esc(A.baseName((D().source&&D().source.input||'').replace(/\.git$/,'')))+'</span> &middot; model: <span class="mono">'+esc(cfg.model)+'</span> ('+esc(cfg.provider)+')</div>'));
  var wrap=h('div',{id:'chat-wrap'});
  var msgs=h('div',{class:'chat-msgs',id:'chat-msgs'});
  wrap.appendChild(msgs);
  // suggestions
  if(!history.length){
    var sug=h('div',{class:'ai-suggest'});
    ['How does this project work?','What are the main modules?','How does authentication work?','What breaks if I change the core module?','Where does data reach the database?','Explain the largest file like I\u2019m new here.'].forEach(function(q){
      var c=h('span',{class:'chip',text:q});c.addEventListener('click',function(){sendQuestion(q);});sug.appendChild(c);
    });
    msgs.appendChild(sug);
  } else { history.forEach(function(m){appendMsg(msgs,m.role,m.content,m.evidence);}); }
  var inp=h('div',{class:'chat-input'});
  var ta=h('textarea',{rows:'1',placeholder:'Ask about this repository...'});
  var send=h('button',{class:'btn sm',text:'Send',style:'height:auto'});
  inp.appendChild(ta);inp.appendChild(send);wrap.appendChild(inp);
  v.appendChild(wrap);
  content.innerHTML='';content.appendChild(v);
  ta.addEventListener('input',function(){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,140)+'px';});
  ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();var q=ta.value.trim();if(q){ta.value='';ta.style.height='auto';sendQuestion(q);}}});
  send.addEventListener('click',function(){var q=ta.value.trim();if(q){ta.value='';ta.style.height='auto';sendQuestion(q);}});
});

function appendMsg(msgs,role,text,evidence){
  var m=h('div',{class:'msg '+role});
  m.appendChild(h('div',{class:'role',text:role==='user'?'You':'Assistant'}));
  var bubble=h('div',{class:'bubble'});
  bubble.innerHTML=role==='user'?esc(text):renderMd(text);
  m.appendChild(bubble);
  if(evidence&&evidence.length){var ev=h('div',{class:'ev'});evidence.slice(0,10).forEach(function(e){
    var chip=h('span',{class:'chip',text:e.title});
    chip.addEventListener('click',function(){openEvidence(e);});
    ev.appendChild(chip);
  });m.appendChild(ev);}
  msgs.appendChild(m);msgs.scrollTop=msgs.scrollHeight;
  return bubble;
}
function openEvidence(e){
  if(e.type==='file')nav('file/'+encodeURIComponent(e.ref.split(':')[0]));
  else if(e.type==='function'){var fn=D().functions.find(function(f){return f.file+':'+f.line===e.ref;});if(fn)nav('function/'+encodeURIComponent(fn.id));else nav('file/'+encodeURIComponent(e.ref.split(':')[0]));}
  else if(e.type==='table')nav('table/'+encodeURIComponent(e.title));
  else if(e.type==='route')nav('apis');
  else if(e.type==='flow')nav('flow/'+encodeURIComponent((D().flows.find(function(f){return f.name===e.title;})||{}).id||''));
  else if(e.type==='class'){var c=D().classes.find(function(x){return x.name===e.title;});if(c)nav('class/'+encodeURIComponent(c.id));}
}

function sendQuestion(question){
  var msgs=document.getElementById('chat-msgs');if(!msgs)return;
  var sug=msgs.querySelector('.ai-suggest');if(sug)sug.remove();
  appendMsg(msgs,'user',question);
  history.push({role:'user',content:question});
  var bubble=appendMsg(msgs,'assistant','');bubble.innerHTML='<span class="mini">thinking...</span>';
  var full='';var evidence=[];
  var cfg=getCfg();
  fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:D().source.id,question:question,history:history.slice(0,-1).slice(-6),config:cfg})})
    .then(function(res){
      if(!res.ok||!res.body){return res.json().then(function(j){throw new Error(j.error||'AI request failed');});}
      var reader=res.body.getReader();var dec=new TextDecoder();var buf='';
      function pump(){return reader.read().then(function(r){
        if(r.done)return;
        buf+=dec.decode(r.value,{stream:true});
        var blocks=buf.split('\n\n');buf=blocks.pop();
        blocks.forEach(function(block){
          var ev=block.match(/event: (.*)/),dm=block.match(/data: ([\s\S]*)/);if(!dm)return;var data;try{data=JSON.parse(dm[1]);}catch(e){return;}
          var name=ev?ev[1].trim():'message';
          if(name==='evidence'){evidence=data;}
          else if(name==='delta'){if(full===''){bubble.innerHTML='';}full+=data.text;bubble.innerHTML=renderMd(full);msgs.scrollTop=msgs.scrollHeight;}
          else if(name==='error'){bubble.innerHTML='<span class="sev-high">Error: '+esc(data.message)+'</span>';}
          else if(name==='done'){finish();}
        });
        return pump();
      });}
      return pump();
    })
    .then(function(){finish();})
    .catch(function(e){bubble.innerHTML='<span class="sev-high">Error: '+esc(e.message)+'</span>';});
  function finish(){
    if(full){history.push({role:'assistant',content:full,evidence:evidence});
      // attach evidence chips
      if(evidence.length){var m=bubble.closest('.msg');if(m&&!m.querySelector('.ev')){var ev=h('div',{class:'ev'});evidence.slice(0,10).forEach(function(e){var chip=h('span',{class:'chip',text:e.title});chip.addEventListener('click',function(){openEvidence(e);});ev.appendChild(chip);});m.appendChild(ev);}}
    }
  }
}

// minimal markdown -> html (paragraphs, code, bold, lists, file:line links)
function renderMd(t){
  t=esc(t);
  t=t.replace(/```([\s\S]*?)```/g,function(_,c){return '<pre>'+c.replace(/^\n/,'')+'</pre>';});
  t=t.replace(/`([^`]+)`/g,'<code>$1</code>');
  t=t.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  // file:line references -> clickable
  t=t.replace(/([\w./\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|c|cpp|h|hpp|swift|dart|scala|sql|json|ya?ml))(?::(\d+))?/g,function(m,file,line){
    return '<span class="c-link" onclick="RIAPP_openRef(\''+encodeURIComponent(file)+'\')">'+m+'</span>';
  });
  var lines=t.split('\n');var out=[];var inList=false;
  lines.forEach(function(l){
    var hm=l.match(/^(#{1,4})\s+(.*)$/);
    if(hm){if(inList){out.push('</ul>');inList=false;}var lvl=Math.min(hm[1].length+1,5);out.push('<h'+lvl+' style="margin:12px 0 6px;font-size:'+(16-hm[1].length)+'px">'+hm[2]+'</h'+lvl+'>');return;}
    if(/^\s*[-*]\s+/.test(l)){if(!inList){out.push('<ul>');inList=true;}out.push('<li>'+l.replace(/^\s*[-*]\s+/,'')+'</li>');}
    else{if(inList){out.push('</ul>');inList=false;}if(l.trim())out.push('<p>'+l+'</p>');}
  });
  if(inList)out.push('</ul>');
  return out.join('');
}
window.RIAPP_openRef=function(file){file=decodeURIComponent(file);if(A.IDX.fileByPath&&A.IDX.fileByPath[file])nav('file/'+encodeURIComponent(file));else{var f=D().files.find(function(x){return x.path.endsWith(file)||x.path.endsWith('/'+file);});if(f)nav('file/'+encodeURIComponent(f.path));}};

// ---- Phase 2: shared AI helpers for the intelligence pages (additive) ----
// streamGenerate(payloadPath, body, onDelta, onEvent) -> Promise. SSE reader
// reused by AI Overview, Learn, Explain, Commit. Never called unless AI is on.
function streamGenerate(pathUrl, body, onDelta, onEvent){
  return fetch(pathUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(res){
      if(!res.ok||!res.body){return res.json().then(function(j){throw new Error(j.error||'request failed');});}
      var reader=res.body.getReader();var dec=new TextDecoder();var buf='';
      function pump(){return reader.read().then(function(r){
        if(r.done)return;
        buf+=dec.decode(r.value,{stream:true});
        var blocks=buf.split('\n\n');buf=blocks.pop();
        blocks.forEach(function(block){
          var ev=block.match(/event: (.*)/),dm=block.match(/data: ([\s\S]*)/);if(!dm)return;var data;try{data=JSON.parse(dm[1]);}catch(e){return;}
          var name=ev?ev[1].trim():'message';
          if(name==='delta'&&onDelta)onDelta(data.text);
          else if(onEvent)onEvent(name,data);
        });
        return pump();
      });}
      return pump();
    });
}
window.RIAI={getCfg:getCfg,setCfg:setCfg,aiReady:aiReady,renderMd:renderMd,streamGenerate:streamGenerate,CFG_KEY:CFG_KEY,PROVIDERS:PROVIDERS};
})();
