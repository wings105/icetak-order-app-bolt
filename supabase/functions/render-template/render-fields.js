const keyPattern=/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const reserved=new Set(['sku','constructor','prototype','__proto__','version','expires','sig']);
export function patternKeys(pattern){return [...new Set([...String(pattern||'').matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map(m=>m[1]))];}
export function getInputFields(config){
 const fields=new Map();
 for(const l of config.layers||[{field:'name',label:'Wording'}])for(const key of l.pattern?patternKeys(l.pattern):[l.field])if(!fields.has(key))fields.set(key,{key,label:l.field_labels?.[key]||(key===l.field?l.label:key)});
 return [...fields.values()];
}
export function validatePatterns(config){
 for(const l of config.layers||[]){
  if(l.pattern!==undefined){
   if(typeof l.pattern!=='string'||!l.pattern||l.pattern.length>400||!patternKeys(l.pattern).length||/[{}]/.test(l.pattern.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,'')))throw new Error('Pola wording tidak sah. Contoh: {{name}} turns {{age}}');
   for(const key of patternKeys(l.pattern))if(!keyPattern.test(key)||reserved.has(key))throw new Error('Nama field tidak sah');
  }
  if(l.field_labels!==undefined){if(!l.field_labels||typeof l.field_labels!=='object'||Array.isArray(l.field_labels)||Object.keys(l.field_labels).length>8)throw new Error('Label field tidak sah');for(const [key,label] of Object.entries(l.field_labels))if(!keyPattern.test(key)||reserved.has(key)||typeof label!=='string'||!label.trim()||label.length>60)throw new Error('Label field tidak sah');}
 }
 if(getInputFields(config).length>8)throw new Error('Maksimum 8 input field');
}
export function resolveValues(config,input,{required=false,strict=false}={}){
 const values=Object.create(null);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('fields mesti object');
 for(const [key,value] of Object.entries(input)){if(!keyPattern.test(key)||reserved.has(key)||typeof value!=='string'||value.length>200)throw new Error('Field '+key+' tidak sah / maksimum 200 aksara');values[key]=value.trim();}
 // Opt-in compatibility: old full-phrase name links still work after adding a pattern.
 for(const l of config.layers||[])if(l.pattern&&l.legacy_full_wording&&patternKeys(l.pattern).some(k=>!values[k])&&values[l.field]){
  const keys=[];let cursor=0,expression='^';for(const m of l.pattern.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)){expression+=l.pattern.slice(cursor,m.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.+?)';keys.push(m[1]);cursor=m.index+m[0].length;}expression+=l.pattern.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';const match=values[l.field].match(new RegExp(expression,'i'));if(match)keys.forEach((k,i)=>{values[k]=match[i+1].trim();});
 }
 const fields=getInputFields(config),known=new Set(fields.map(f=>f.key));
 if(strict)for(const key of Object.keys(values))if(!known.has(key))throw new Error('Field '+key+' tidak wujud dalam template');
 if(required)for(const f of fields)if(!values[f.key])throw new Error('Isi '+f.label+' ('+f.key+') dahulu');
 for(const l of config.layers||[])if(resolveLayerText(l,values).length>200)throw new Error(l.label+': hasil wording maksimum 200 aksara');
 return values;
}
export function resolveLayerText(layer,values){return layer.pattern?layer.pattern.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,(_,key)=>values[key]||''):String(values[layer.field]??'');}
