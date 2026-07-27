/* pages9.js — GitHub sign-in + "browse my repositories" picker.
 *
 * The access token stays on the server; the browser only holds an httpOnly
 * session cookie. This module:
 *   - queries /api/auth/me to render either a "Sign in with GitHub" button or a
 *     signed-in user chip (on the landing page and the app topbar),
 *   - opens a repo picker (GET /api/github/repos) with live filtering,
 *   - starts analysis of the chosen repo via the existing SSE analyze flow.
 */
(function(){
  'use strict';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  var GH_ICON='<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style="vertical-align:-3px"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

  var STATE={ me:null };

  function api(path,opts){ return fetch(path,Object.assign({credentials:'same-origin'},opts||{})).then(function(r){return r.json().catch(function(){return null;});}); }

  function login(){
    var returnTo=location.pathname+location.hash;
    location.href='/api/auth/github/login?returnTo='+encodeURIComponent(returnTo);
  }
  function logout(){
    fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).then(function(){STATE.me={authenticated:false,configured:STATE.me&&STATE.me.configured};renderAuth();});
  }

  // ---- auth chip (landing + topbar) ----
  function authNode(where){
    var me=STATE.me;
    if(!me) return null;
    if(!me.configured){
      if(where==='landing') return el('<div class="gh-note mini">Tip: enable <b>Sign in with GitHub</b> to browse and analyze your own repos (set GITHUB_OAUTH_CLIENT_ID/SECRET on the server).</div>');
      return null;
    }
    if(me.authenticated){
      var wrap=document.createElement('div'); wrap.className='gh-user';
      var av=me.user.avatarUrl?'<img class="gh-av" src="'+esc(me.user.avatarUrl)+'" alt=""/>':'';
      wrap.innerHTML=av+'<span class="gh-login">'+esc(me.user.login)+'</span>';
      var browse=document.createElement('button'); browse.className='btn sm'; browse.innerHTML=GH_ICON+' My repositories';
      browse.addEventListener('click',openPicker);
      var out=document.createElement('button'); out.className='btn ghost sm'; out.textContent='Sign out'; out.addEventListener('click',logout);
      var box=document.createElement('div'); box.className='gh-userbox';
      box.appendChild(wrap); box.appendChild(browse); box.appendChild(out);
      return box;
    }
    var b=document.createElement('button'); b.className='btn gh-signin'; b.innerHTML=GH_ICON+' Sign in with GitHub';
    b.addEventListener('click',login);
    return b;
  }

  function renderAuth(){
    var slot=document.getElementById('gh-auth');
    if(slot){ slot.innerHTML=''; var n=authNode('landing'); if(n)slot.appendChild(n); }
    // topbar chip (inside the app)
    var tb=document.getElementById('topbar');
    if(tb){
      var ex=document.getElementById('gh-auth-top'); if(ex)ex.remove();
      var n2=authNode('top');
      if(n2){ var holder=document.createElement('div'); holder.id='gh-auth-top'; holder.className='gh-auth-top'; holder.appendChild(n2); tb.appendChild(holder); }
    }
  }
  function el(html){var d=document.createElement('div');d.innerHTML=html;return d.firstElementChild;}

  // ---- repo picker modal ----
  var REPOS=[];
  function openPicker(){
    var ov=document.getElementById('ghpick-overlay');
    ov.classList.add('on');
    var list=document.getElementById('ghpick-list');
    list.innerHTML='<div class="mini" style="padding:16px">Loading your repositories...</div>';
    document.getElementById('ghpick-search').value='';
    api('/api/github/repos').then(function(r){
      if(!r||r.error){ list.innerHTML='<div class="mini sev-high" style="padding:16px">'+esc((r&&r.error)||'Could not load repos')+'</div>'; return; }
      REPOS=r.repos||[];
      drawRepos('');
    });
    setTimeout(function(){document.getElementById('ghpick-search').focus();},50);
  }
  function closePicker(){ document.getElementById('ghpick-overlay').classList.remove('on'); }

  function drawRepos(filter){
    var list=document.getElementById('ghpick-list');
    var f=(filter||'').toLowerCase();
    var rows=REPOS.filter(function(x){return !f||x.fullName.toLowerCase().indexOf(f)>=0||(x.description||'').toLowerCase().indexOf(f)>=0;});
    if(!rows.length){ list.innerHTML='<div class="mini" style="padding:16px">No matching repositories.</div>'; return; }
    list.innerHTML='';
    rows.slice(0,300).forEach(function(x){
      var row=document.createElement('div'); row.className='ghrepo';
      var priv=x.private?'<span class="ghtag priv">private</span>':'<span class="ghtag pub">public</span>';
      var lang=x.language?'<span class="ghlang">'+esc(x.language)+'</span>':'';
      var desc=x.description?'<div class="ghdesc">'+esc(x.description)+'</div>':'';
      row.innerHTML='<div class="ghmain"><div class="ghname">'+esc(x.fullName)+' '+priv+'</div>'+desc+'</div><div class="ghmeta">'+lang+(x.stars?'<span class="ghstar">\u2605 '+x.stars+'</span>':'')+'</div>';
      row.addEventListener('click',function(){ analyzeRepo(x); });
      list.appendChild(row);
    });
  }

  function analyzeRepo(x){
    closePicker();
    // leave the app view, show the landing progress panel, and start SSE analyze
    var landing=document.getElementById('landing'), app=document.getElementById('app');
    if(app)app.classList.remove('on');
    if(landing)landing.style.display='flex';
    var input=document.getElementById('repo-input'); if(input)input.value=x.htmlUrl||('https://github.com/'+x.fullName);
    if(window.RISTARTANALYZE) window.RISTARTANALYZE(x.htmlUrl||('https://github.com/'+x.fullName));
  }

  // ---- wire up ----
  function init(){
    api('/api/auth/me').then(function(me){ STATE.me=me||{authenticated:false,configured:false}; renderAuth(); });
    var x=document.getElementById('ghpick-x'); if(x)x.addEventListener('click',closePicker);
    var ov=document.getElementById('ghpick-overlay'); if(ov)ov.addEventListener('click',function(e){if(e.target===ov)closePicker();});
    var s=document.getElementById('ghpick-search'); if(s)s.addEventListener('input',function(e){drawRepos(e.target.value);});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closePicker();});
    // if we just came back from a successful login, drop the ?login=ok noise
    if(/[?&]login=ok/.test(location.search)){ history.replaceState(null,'',location.pathname+location.hash); }
    var m=/[?&]login_error=([^&]+)/.exec(location.search);
    if(m){ try{ alert('GitHub sign-in failed: '+decodeURIComponent(m[1])); }catch(_){ } history.replaceState(null,'',location.pathname+location.hash); }
  }
  // re-render the topbar chip whenever the app view changes
  window.RIGH_REFRESH=renderAuth;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init); else init();
})();
