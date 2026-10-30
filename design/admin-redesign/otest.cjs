// usage: node otest.cjs file startOn  -> exposes run(fn) with c (component) and V() fresh vals
const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const src=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
global.setTimeout=()=>0; global.clearTimeout=()=>0;
const C=new Function('DCLogic',src+'\nreturn Component;')(class{setState(p){this.state=Object.assign({},this.state,p)}});
const c=new C();c.props={startOn:process.argv[3]};c.state={};
const V=()=>c.renderVals();
const ev=v=>({target:{value:v},key:v,preventDefault(){},stopPropagation(){}});
eval(fs.readFileSync(process.argv[4],'utf8'));
