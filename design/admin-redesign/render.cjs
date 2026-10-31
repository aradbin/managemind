// usage: node render.cjs in.dc.html out.html [propsJSON] [stateJSON] [jsAfter]
const fs=require('fs');
const [,,inp,out,pj,sj,after]=process.argv;
const html=fs.readFileSync(inp,'utf8');
const src=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const C=new Function('DCLogic',src+'\nreturn Component;')(class{setState(p){this.state=Object.assign({},this.state,p)}});
const c=new C();c.props=JSON.parse(pj||'{}');c.state=JSON.parse(sj||'{}');
let v=c.renderVals();
if(after){eval(after);v=c.renderVals();}
const style=(html.match(/<helmet>([\s\S]*?)<\/helmet>/)||['',''])[1];
let body=html.slice(html.indexOf('</helmet>')+9, html.indexOf('<script type="text/x-dc"'));
body=body.replace(/<\/?x-dc>/g,'').replace(/<\/?body>|<\/html>/g,'');
// tree
const re=/<sc-(if|for)\b([^>]*)>|<\/sc-(if|for)>/g;
function parse(s){const root={kids:[]};const st=[root];let last=0,m;while((m=re.exec(s))){const top=st[st.length-1];if(m.index>last)top.kids.push(s.slice(last,m.index));if(m[1]){const n={type:m[1],attrs:m[2],kids:[]};top.kids.push(n);st.push(n);}else st.pop();last=re.lastIndex;}if(last<s.length)root.kids.push(s.slice(last));return root;}
function get(scope,path){const segs=path.split('.');let b;for(let i=scope.length-1;i>=0;i--){if(segs[0] in scope[i]){b=scope[i][segs[0]];break;}}for(const s of segs.slice(1)){if(b==null)return undefined;b=b[s];}return b;}
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
function text(s,scope){
  // attributes
  s=s.replace(/\s(on[A-Z]\w*)="\{\{[^}]*\}\}"/g,'');
  s=s.replace(/\s([\w-]+)="\{\{\s*([\w.]+)\s*\}\}"/g,(all,a,p)=>{const val=p==='true'?true:p==='false'?false:get(scope,p);if(typeof val==='function')return '';if(val===false||val==null){return /^(aria-|data-)/.test(a)?` ${a}="false"`:'';}if(val===true)return /^(aria-|data-)/.test(a)?` ${a}="true"`:` ${a}`;return ` ${a}="${esc(val)}"`;});
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g,(a,p)=>{const val=get(scope,p);return val==null||typeof val==='function'?'':esc(val);});
}
function render(n,scope){let o='';for(const k of n.kids){if(typeof k==='string'){o+=text(k,scope);continue;}const p=(k.attrs.match(/(?:value|list)="\{\{\s*([\w.]+)\s*\}\}"/)||[])[1];const val=p==='true'?true:p==='false'?false:get(scope,p);
 if(k.type==='if'){if(val)o+=render(k,scope);}else{const as=k.attrs.match(/as="(\w+)"/)[1];for(const it of (val||[])){const sc={};sc[as]=it;o+=render(k,scope.concat([sc]));}}}return o;}
const outHtml='<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><style>body{margin:0}</style>'+style+'</head><body>'+render(parse(body),[v])+'</body></html>';
fs.writeFileSync(out,outHtml);
