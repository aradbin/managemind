// usage: node smoke2.cjs file.dc.html [propsJSON] [stateJSON]
const fs=require('fs');
const f=process.argv[2];
const html=fs.readFileSync(f,'utf8');
const src=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const props=JSON.parse(process.argv[3]||'{}');
const C=new Function('DCLogic',src+'\nreturn Component;')(class{setState(p){this.state=Object.assign({},this.state,p)}});
const c=new C();c.props=props;c.state=JSON.parse(process.argv[4]||'{}');
const v=c.renderVals();
const tpl=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<helmet>[\s\S]*?<\/helmet>/,'');
const loops={};
for(const m of tpl.matchAll(/<sc-for list="\{\{([\w.]+)\}\}" as="(\w+)"/g)) loops[m[2]]=m[1];
const resolve=(path,depth=0)=>{
  const segs=path.split('.');let base;
  if(loops[segs[0]]&&depth<6){const arr=resolve(loops[segs[0]],depth+1);if(arr===undefined)return undefined;if(!Array.isArray(arr))return undefined;if(!arr.length)return null;base=arr[0];}
  else base=v[segs[0]];
  for(const s of segs.slice(1)){if(base===null)return null;if(base===undefined)return undefined;base=base[s];}
  return base;
};
const missing=new Set(), emptyLists=new Set();
for(const h of tpl.matchAll(/\{\{\s*([\w$.]+)\s*\}\}/g)){const k=h[1];if(['true','false'].includes(k)||/^\d/.test(k))continue;const r=resolve(k);if(r===undefined)missing.add(k);if(r===null)emptyLists.add(k.split('.')[0]);}
console.log(f.split('/').pop(),props.startOn||'', 'missing:',[...missing].join(',')||'none', emptyLists.size?'(empty lists: '+[...emptyLists].join(',')+')':'');
if(process.argv[5]) eval(process.argv[5]);
