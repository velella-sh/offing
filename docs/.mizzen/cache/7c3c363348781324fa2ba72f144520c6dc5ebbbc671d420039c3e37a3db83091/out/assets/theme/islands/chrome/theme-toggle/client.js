import{THEME_KEY}from"./key.js";const WORDS={light:"Light",system:"System",dark:"Dark"};export function resolve(choice,prefersLight){if(choice==="system")return prefersLight?"light":"dark";return choice;}
export function read(storage){try{const saved=storage.getItem(THEME_KEY);return saved==="light"||saved==="dark"||saved==="system"?saved:"system";}catch{return"system";}}
export function save(storage,choice){try{storage.setItem(THEME_KEY,choice);}catch{}}
export function apply(env,choice){env.root.setAttribute("data-theme",resolve(choice,env.prefersLight));}
const ORDER=["light","system","dark"];export function next(choice){return ORDER[(ORDER.indexOf(choice)+1)%ORDER.length];}
export function sync(toggle,choice){toggle.hidden=false;toggle.setAttribute("data-choice",choice);const label=`Color theme: ${WORDS[choice]}. Switch to ${WORDS[next(choice)].toLowerCase()}.`;toggle.querySelector(".theme-toggle-button")?.setAttribute("aria-label",label);}
export function announce(toggle,choice){const status=toggle.querySelector(".theme-toggle-status");if(status)status.textContent=`${WORDS[choice]} theme.`;}
export function choose(env,toggle,choice){save(env.storage,choice);apply(env,choice);sync(toggle,choice);announce(toggle,choice);}
export function activate(toggle,env){let current=read(env.storage);sync(toggle,current);apply(env,current);toggle.addEventListener("click",()=>{current=next(current);choose(env,toggle,current);});}
function live(){return{storage:localStorage,root:document.documentElement,prefersLight:matchMedia("(prefers-color-scheme: light)").matches,};}
if(typeof document!=="undefined"){const toggle=document.querySelector("[data-theme-toggle]");if(toggle)activate(toggle,live());}