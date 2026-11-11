export const STORAGE_PREFIX="lateen-announcement:";export const DISMISS_SELECTOR="[data-announcement-dismiss]";export function storageKey(id){return`${STORAGE_PREFIX}${id}`;}
const DISMISSED="true";export function isDismissed(storage,id){try{return storage.getItem(storageKey(id))===DISMISSED;}catch{return false;}}
export function remember(storage,id){try{storage.setItem(storageKey(id),DISMISSED);}catch{}}
export function activate(bar,storage,id){if(isDismissed(storage,id)){bar.hidden=true;return;}
const button=bar.querySelector(DISMISS_SELECTOR);if(button===null)return;button.hidden=false;button.addEventListener("click",()=>{bar.hidden=true;remember(storage,id);});}
if(typeof document!=="undefined"){const bar=document.querySelector("[data-announcement]");if(bar)activate(bar,localStorage,bar.getAttribute("data-announcement-id")??"announcement");}