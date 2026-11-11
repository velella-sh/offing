const FULL_SPAN=/^(.*):(\d+):(\d+)-(\d+):(\d+)$/;const POINT_WITH_COLUMN=/^(.*):(\d+):(\d+)$/;const POINT=/^(.*):(\d+)$/;export const MAX_TEXT=160;export const RESET_MS=2000;function positive(...values){return values.every((value)=>Number.isInteger(value)&&value>=1);}
function spanOfParts(file,line,column,endLine,endColumn,){if(!file||!positive(line,column,endLine,endColumn))return undefined;if(endLine<line||(endLine===line&&endColumn<column))return undefined;return{file,line,column,endLine,endColumn};}
export function parseSpan(value){const full=FULL_SPAN.exec(value);if(full){return spanOfParts(full[1],Number(full[2]),Number(full[3]),Number(full[4]),Number(full[5]));}
const withColumn=POINT_WITH_COLUMN.exec(value);if(withColumn){const line=Number(withColumn[2]);const column=Number(withColumn[3]);return spanOfParts(withColumn[1],line,column,line,column);}
const point=POINT.exec(value);if(point){const line=Number(point[2]);return spanOfParts(point[1],line,1,line,1);}
return undefined;}
export function summarizeText(value,max=MAX_TEXT){const oneLine=value.replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim();if(oneLine.length<=max)return oneLine;return`${oneLine.slice(0, Math.max(0, max - 1)).trimEnd()}…`;}
export function promptFor(template,source,text){return template
.replace(/\{(source|text)\}/g,(_placeholder,name)=>(name==="source"?source:text))
.replace(/\s+/g," ")
.trim();}
const NO_BUTTON=new Set(["UL","OL","DL","TABLE","THEAD","TBODY","TR"]);export function isNested(block){for(let parent=block.parentElement;parent!==null;parent=parent.parentElement){if(parent.getAttribute("data-src")!==null)return true;}
return false;}
export function topLevel(blocks){const out=[];for(const block of blocks){const source=block.getAttribute("data-src");if(source===null||parseSpan(source)===undefined)continue;if(isNested(block))continue;if(block.tagName!==undefined&&NO_BUTTON.has(block.tagName))continue;out.push(block);}
return out;}
function say(button,text,label,env){button.textContent=text;env.schedule(()=>{button.textContent=label;},RESET_MS);}
export function copy(button,label,env){const clipboard=env.clipboard;if(clipboard===undefined)return Promise.resolve();return clipboard.writeText(button.dataset.prompt??"").then(()=>say(button,button.dataset.copied??label,label,env),()=>say(button,button.dataset.copyFailed??label,label,env),);}
export function activate(env){if(env.clipboard===undefined)return;const sample=env.template.content.firstElementChild;if(sample===null)return;for(const block of topLevel(env.blocks)){const source=block.getAttribute("data-src");if(source===null)continue;const button=sample.cloneNode(true);button.hidden=false;button.dataset.prompt=promptFor(env.template.dataset.prompt??"",source,summarizeText(block.textContent??""));button.dataset.copied=env.template.dataset.copied;button.dataset.copyFailed=env.template.dataset.copyFailed;const label=button.textContent??"";button.addEventListener("click",()=>{void copy(button,label,env);});block.appendChild(button);}}
const globals=globalThis;if(globals.document!==undefined){const template=globals.document.querySelector("[data-block-actions]");if(template!==null){activate({template:template,blocks:globals.document.querySelectorAll("[data-src]"),clipboard:globals.navigator?.clipboard,schedule:(callback,ms)=>globals.setTimeout(callback,ms),});}}