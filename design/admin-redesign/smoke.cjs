// usage: node smoke.js file.dc.html [stateJSON] [propsJSON]
const fs=require('fs');
const f=process.argv[2];
const html=fs.readFileSync(f,'utf8');
const m=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
const src=m[1];
const st=JSON.parse(process.argv[3]||'{}');
const props=JSON.parse(process.argv[4]||'{}');
const C=new Function('DCLogic',src+'\nreturn Component;')(class{setState(p){this.state=Object.assign({},this.state,p)}});
const c=new C();c.props=props;c.state=st;
const v=c.renderVals();
// check template top-level holes
const tpl=html.replace(/<script[\s\S]*?<\/script>/g,'');
const loopVars=new Set([...tpl.matchAll(/ as="(\w+)"/g)].map(x=>x[1]));
const missing=new Set();
for(const h of tpl.matchAll(/\{\{\s*([\w$]+)/g)){const k=h[1];if(['true','false'].includes(k)||/^\d/.test(k))continue;if(!loopVars.has(k)&&!(k in v))missing.add(k)}
console.log(f.split('/').pop(),'ok; missing:',[...missing].join(',')||'none');
module.exports={c,v};
if(process.argv[5]){eval(process.argv[5])}
